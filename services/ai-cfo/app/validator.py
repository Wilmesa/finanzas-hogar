from decimal import Decimal, InvalidOperation

from .models import InsightBundle, InsightSnapshot


def validate_bundle(bundle: InsightBundle, snapshot: InsightSnapshot) -> InsightBundle:
    evidence_ids = {item.id for item in snapshot.evidence}
    referenced = set()
    for alert in bundle.alerts:
        referenced.update(alert.evidenceIds)
    for finding in bundle.spendingFindings:
        referenced.update(finding.evidenceIds)
    for opportunity in bundle.opportunities:
        referenced.update(opportunity.evidenceIds)
        try:
            Decimal(opportunity.estimatedMonthlyImpact)
        except InvalidOperation as exc:
            raise ValueError("Impacto mensual inválido") from exc
    unknown = referenced - evidence_ids
    if unknown:
        raise ValueError(f"Evidencias inexistentes: {sorted(unknown)}")

    allowed_news = {str(item.sourceUrl) for item in snapshot.news}
    for news in bundle.news:
        if str(news.sourceUrl) not in allowed_news:
            raise ValueError("La respuesta introdujo una fuente de noticias no autorizada")
    return bundle

