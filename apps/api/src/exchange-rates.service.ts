import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

const PRIMARY_TRM_API =
  "https://www.superfinanciera.gov.co/SuperfinancieraWebServiceTRM/TCRMServicesWebService/TCRMServicesWebService";
const FALLBACK_TRM_API = "https://www.datos.gov.co/resource/32sa-8pi3.json";
const PRIMARY_TRM_SOURCE =
  "Superintendencia Financiera de Colombia / Web Service TRM";
const FALLBACK_TRM_SOURCE =
  "Superintendencia Financiera de Colombia / Datos Abiertos (fallback)";
const SOAP_NAMESPACE =
  "http://action.trm.services.generic.action.superfinanciera.nexura.sc.com.co/";

type TrmObservation = {
  rate: string;
  effectiveDate: Date;
  source: string;
  sourceUrl: string;
};

@Injectable()
export class ExchangeRatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.refreshIfConfigured().catch((cause) =>
      this.logger.warn(
        `No fue posible actualizar la TRM: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      ),
    );
    this.timer = setInterval(
      () =>
        void this.refreshIfConfigured().catch((cause) =>
          this.logger.warn(
            `No fue posible actualizar la TRM: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          ),
        ),
      86_400_000,
    );
    this.timer.unref();
  }

  private async refreshIfConfigured() {
    const enabled =
      process.env.TRM_SYNC_ENABLED === "true" ||
      (await this.prisma.integrationPreference.count({
        where: { trmDailySyncEnabled: true },
      })) > 0;
    if (enabled) await this.refreshTrm();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async refreshTrm(effectiveDate?: string) {
    const requestedDate = effectiveDate ?? this.bogotaDate();
    let observation: TrmObservation;
    try {
      observation = await this.fetchPrimary(requestedDate);
    } catch (primaryError) {
      this.logger.warn(
        `TRM primaria no disponible; se usará fallback: ${
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError)
        }`,
      );
      try {
        observation = await this.fetchFallback(requestedDate);
      } catch (fallbackError) {
        throw new ServiceUnavailableException({
          message: "Ninguna fuente TRM entregó un dato válido",
          primary:
            primaryError instanceof Error
              ? primaryError.message
              : String(primaryError),
          fallback:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        });
      }
    }
    return this.persist(observation);
  }

  private async fetchPrimary(effectiveDate: string): Promise<TrmObservation> {
    const api = process.env.TRM_PRIMARY_URL ?? PRIMARY_TRM_API;
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:trm="${SOAP_NAMESPACE}">
  <soapenv:Header/>
  <soapenv:Body>
    <trm:queryTCRM>
      <tcrmQueryAssociatedDate>${effectiveDate}</tcrmQueryAssociatedDate>
    </trm:queryTCRM>
  </soapenv:Body>
</soapenv:Envelope>`;
    const response = await fetch(api, {
      method: "POST",
      headers: {
        Accept: "text/xml",
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '""',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`SFC SOAP respondió HTTP ${response.status}`);
    }
    const xml = await response.text();
    const success = this.xmlValue(xml, "success");
    const value = this.xmlValue(xml, "value");
    const validityFrom = this.xmlValue(xml, "validityFrom");
    if (success !== "true" || !value || !validityFrom || !(Number(value) > 0)) {
      throw new Error("SFC SOAP no entregó una observación válida");
    }
    return {
      rate: value,
      effectiveDate: new Date(`${validityFrom.slice(0, 10)}T00:00:00.000Z`),
      source: PRIMARY_TRM_SOURCE,
      sourceUrl: api,
    };
  }

  private async fetchFallback(effectiveDate: string): Promise<TrmObservation> {
    const api =
      process.env.TRM_FALLBACK_URL ??
      process.env.TRM_API_URL ??
      FALLBACK_TRM_API;
    const where = effectiveDate
      ? `&$where=vigenciadesde <= '${effectiveDate}T23:59:59.999'`
      : "";
    const response = await fetch(
      `${api}?$limit=1&$order=vigenciadesde%20DESC${encodeURI(where)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Datos Abiertos respondió HTTP ${response.status}`);
    }
    const rows = (await response.json()) as Array<{
      valor?: string;
      vigenciadesde?: string;
    }>;
    const row = rows[0];
    if (!row?.valor || !row.vigenciadesde || !(Number(row.valor) > 0)) {
      throw new Error("Datos Abiertos no entregó una observación válida");
    }
    return {
      rate: row.valor,
      effectiveDate: new Date(
        `${row.vigenciadesde.slice(0, 10)}T00:00:00.000Z`,
      ),
      source: FALLBACK_TRM_SOURCE,
      sourceUrl: api,
    };
  }

  private persist(observation: TrmObservation) {
    return this.prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency_effectiveDate_source: {
          baseCurrency: "USD",
          quoteCurrency: "COP",
          effectiveDate: observation.effectiveDate,
          source: observation.source,
        },
      },
      create: {
        baseCurrency: "USD",
        quoteCurrency: "COP",
        effectiveDate: observation.effectiveDate,
        rate: new Prisma.Decimal(observation.rate),
        source: observation.source,
        sourceUrl: observation.sourceUrl,
      },
      update: {
        rate: new Prisma.Decimal(observation.rate),
        sourceUrl: observation.sourceUrl,
        fetchedAt: new Date(),
      },
    });
  }

  private xmlValue(xml: string, tag: string) {
    const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "i"));
    return match?.[1]?.trim();
  }

  private bogotaDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${value.year}-${value.month}-${value.day}`;
  }

  async rate(
    baseCurrency: string,
    quoteCurrency: string,
    effectiveDate: string,
  ) {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    if (base === quote) {
      return {
        baseCurrency: base,
        quoteCurrency: quote,
        rate: new Prisma.Decimal(1),
        source: "identity",
        effectiveDate: new Date(`${effectiveDate}T00:00:00Z`),
      };
    }
    let result = await this.prisma.exchangeRate.findFirst({
      where: {
        baseCurrency: base,
        quoteCurrency: quote,
        effectiveDate: { lte: new Date(`${effectiveDate}T23:59:59Z`) },
      },
      orderBy: { effectiveDate: "desc" },
    });
    if (!result && base === "USD" && quote === "COP") {
      result = await this.refreshTrm(effectiveDate);
    }
    if (!result) {
      throw new ServiceUnavailableException(
        `No existe una tasa trazable para ${base}/${quote}`,
      );
    }
    return result;
  }
}
