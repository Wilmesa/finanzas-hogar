<?php
// Laravel's CLI bootstrap can print friendly output; only the token may reach stdout.
ob_start();
try {
// Only invoked inside the disposable finanzas-smoke-* Compose project.
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (getenv('APP_ENV') !== 'testing') {
    throw new RuntimeException('Refusing to bootstrap outside testing');
}
config(['app.env' => 'testing']);
if (FireflyIII\User::count() !== 0) {
    throw new RuntimeException('Refusing to bootstrap a non-empty ledger');
}
if (Illuminate\Support\Facades\Artisan::call('system:create-first-user', ['email' => 'ledger@smoke.invalid']) !== 0) {
    throw new RuntimeException('Could not create disposable ledger user');
}
Illuminate\Support\Facades\Artisan::call('correction:create-group-memberships');
$user = FireflyIII\User::where('email', 'ledger@smoke.invalid')->firstOrFail();
Illuminate\Support\Facades\Artisan::call('passport:client', [
    '--personal' => true,
    '--name' => 'okle-disposable-smoke',
    '--provider' => 'users',
    '--no-interaction' => true,
]);
$token = $user->createToken('okle-disposable-smoke')->accessToken;
ob_end_clean();
if (!preg_match('/^[A-Za-z0-9._-]+$/', $token)) {
    throw new RuntimeException('Unexpected disposable token format');
}
echo "\nOKLE_SMOKE_TOKEN=" . $token . "\n";
} catch (Throwable $error) {
    while (ob_get_level() > 0) { ob_end_clean(); }
    fwrite(STDERR, 'Disposable Firefly bootstrap failed: ' . get_class($error) . ': ' . $error->getMessage() . "\n");
    exit(1);
}
