/**
 * Sends one message through whatever transport the environment resolves to.
 *
 * For checking a relay's credentials and DNS without going through the app:
 *
 *   pnpm --filter @facturx/mail send-test vous@exemple.fr
 *
 * With no SMTP_HOST it prints to the console, so running it is always safe.
 */

import { resolveMailConfig } from '../src/index.js';

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: pnpm --filter @facturx/mail send-test <adresse>');
    process.exitCode = 1;
    return;
  }

  const { transport, from, baseUrl } = resolveMailConfig();
  console.info(`transport : ${transport.key}`);
  console.info(`from      : ${from}`);
  console.info(`liens     : ${baseUrl}`);
  console.info(`à         : ${to}\n`);

  await transport.send({
    to,
    subject: 'Test de configuration — Factur-X',
    text: [
      'Ceci est un message de test.',
      '',
      "Si vous le recevez, la configuration d'envoi fonctionne : les réinitialisations de mot de",
      'passe et les invitations partiront correctement.',
      '',
      `Transport : ${transport.key}`,
      `Expéditeur : ${from}`,
    ].join('\n'),
  });

  console.info('\nEnvoyé sans erreur.');
  if (transport.key === 'smtp') {
    console.info(
      'Vérifiez la réception, y compris les indésirables. Un message classé en spam indique',
      "qu'il manque SPF ou DKIM sur le domaine de l'expéditeur.",
    );
  }
}

void main().catch((error: unknown) => {
  console.error('\nÉchec :', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
