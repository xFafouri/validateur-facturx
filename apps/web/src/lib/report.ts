import type { AnalysisDto } from '@facturx/core';

/**
 * Renders a validation report as plain text, in the browser.
 *
 * Built client-side from the response the page already holds, so downloading a report sends
 * nothing to the server and stores nothing anywhere. That matters: the page promises the invoice
 * is "analysée puis immédiatement oubliée", and a server-side report generator - or emailing the
 * report - would quietly make that untrue.
 *
 * Plain text rather than PDF because the realistic use is an accountant pasting the findings into
 * an email to a client, or attaching something a colleague can read without a viewer.
 */

const RULE = '='.repeat(72);
const THIN = '-'.repeat(72);

function wrap(text: string, width = 72, indent = ''): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line === '') {
      line = word;
    } else if ((line + ' ' + word).length <= width - indent.length) {
      line += ' ' + word;
    } else {
      lines.push(indent + line);
      line = word;
    }
  }
  if (line !== '') lines.push(indent + line);
  return lines.join('\n');
}

const VERDICT_TEXT: Record<string, string> = {
  conforme: 'CONFORME - aucune erreur bloquante détectée',
  'non-conforme': 'NON CONFORME - des anomalies bloquantes ont été détectées',
  indeterminé: 'INDÉTERMINÉ - le contrôle réglementaire n’a pas pu être effectué',
};

export function buildTextReport(result: AnalysisDto, generatedAt = new Date()): string {
  const out: string[] = [];

  out.push(RULE);
  out.push('RAPPORT DE CONTRÔLE - FACTURE ÉLECTRONIQUE (Factur-X / EN 16931)');
  out.push(RULE);
  out.push('');
  out.push(`Fichier analysé  : ${result.filename}`);
  out.push(`Taille           : ${result.sizeBytes} octets`);
  out.push(`Profil détecté   : ${result.profileLabel ?? 'non déterminé'}`);
  out.push(
    `Date du contrôle : ${generatedAt.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}`,
  );
  out.push('');
  out.push(THIN);
  out.push(`RÉSULTAT : ${VERDICT_TEXT[result.verdict] ?? result.verdict.toUpperCase()}`);
  out.push(THIN);
  out.push('');
  out.push(
    `Erreurs bloquantes : ${result.counts.errors}    ` +
      `Avertissements : ${result.counts.warnings}    ` +
      `Informations : ${result.counts.notices}`,
  );
  out.push('');

  if (result.parseError) {
    out.push('LECTURE DU DOCUMENT');
    out.push(wrap(result.parseError, 72, '  '));
    out.push('');
  }

  if (result.engineError) {
    out.push('AVERTISSEMENT');
    out.push(
      wrap(
        `${result.engineError.message} Les informations ci-dessous proviennent de la lecture du document et ne constituent pas un verdict de conformité.`,
        72,
        '  ',
      ),
    );
    out.push('');
  }

  // --- invoice content ------------------------------------------------------
  if (result.invoice) {
    const inv = result.invoice;
    out.push(THIN);
    out.push('CONTENU DE LA FACTURE');
    out.push(THIN);
    out.push(`  Numéro       : ${inv.invoiceNumber ?? '—'}`);
    out.push(`  Type         : ${inv.typeLabel}`);
    out.push(`  Émise le     : ${inv.issueDate ?? '—'}`);
    out.push(`  Échéance     : ${inv.dueDate ?? '—'}`);
    out.push(
      `  Vendeur      : ${inv.seller.name ?? '—'}${inv.seller.legalId ? ` (${inv.seller.legalId})` : ''}`,
    );
    out.push(
      `  Acheteur     : ${inv.buyer.name ?? '—'}${inv.buyer.legalId ? ` (${inv.buyer.legalId})` : ''}`,
    );
    out.push(`  Total HT     : ${inv.totals.taxBasisTotalAmount?.display ?? '—'}`);
    out.push(`  TVA          : ${inv.totals.taxTotalAmount?.display ?? '—'}`);
    out.push(`  Total TTC    : ${inv.totals.grandTotalAmount?.display ?? '—'}`);
    out.push(`  Net à payer  : ${inv.totals.duePayableAmount?.display ?? '—'}`);
    out.push('');
  }

  // --- arithmetic -----------------------------------------------------------
  if (result.checks.length > 0) {
    out.push(THIN);
    out.push('VÉRIFICATION DES TOTAUX');
    out.push(THIN);
    for (const check of result.checks) {
      out.push(`  [${check.passed ? 'OK' : 'KO'}] ${check.label} (${check.ruleId})`);
      out.push(wrap(check.detail, 72, '       '));
    }
    for (const vat of result.vatChecks) {
      out.push(`  [${vat.passed ? 'OK' : 'KO'}] ${vat.detail}`);
    }
    out.push('');
  }

  if (result.suspectLines.length > 0) {
    out.push(
      wrap(
        `PISTE : l'écart correspond exactement au montant de la ligne ${result.suspectLines.join(', ')}. Cette ligne a probablement été oubliée dans le total, ou comptée deux fois.`,
        72,
        '  ',
      ),
    );
    out.push('');
  }

  // --- findings -------------------------------------------------------------
  const groups: Array<[string, typeof result.findings]> = [
    [
      'ERREURS BLOQUANTES',
      result.findings.filter((f) => ['error', 'fatal', 'exception'].includes(f.severity)),
    ],
    ['AVERTISSEMENTS', result.findings.filter((f) => f.severity === 'warning')],
    ['INFORMATIONS', result.findings.filter((f) => f.severity === 'notice')],
  ];

  for (const [title, findings] of groups) {
    if (findings.length === 0) continue;

    out.push(THIN);
    out.push(`${title} (${findings.length})`);
    out.push(THIN);

    findings.forEach((finding, index) => {
      out.push(
        `  ${index + 1}. [${finding.ruleId ?? '—'}] ${finding.explanation?.title ?? finding.message}`,
      );
      out.push(`     Référentiel : ${finding.rulesetLabel}`);
      if (finding.explanation) {
        out.push('     Ce que la règle exige :');
        out.push(wrap(finding.explanation.meaning, 72, '       '));
        out.push('     Comment corriger :');
        out.push(wrap(finding.explanation.fix, 72, '       '));
      } else {
        out.push(wrap(finding.message, 72, '       '));
      }
      out.push('');
    });
  }

  if (result.inapplicableFindings.length > 0) {
    out.push(THIN);
    out.push(
      `RÈGLES SANS OBJET POUR UNE FACTURE FRANÇAISE (${result.inapplicableFindings.length})`,
    );
    out.push(THIN);
    out.push(
      wrap(
        "Le moteur de validation évalue également les règles nationales allemandes (XRechnung). Elles ne s'appliquent pas à une facture franco-française et sont listées ici pour information uniquement.",
        72,
        '  ',
      ),
    );
    for (const finding of result.inapplicableFindings) {
      out.push(`    - [${finding.ruleId ?? '—'}] ${finding.message}`);
    }
    out.push('');
  }

  out.push(RULE);
  out.push(
    wrap(
      "AVERTISSEMENT : ce rapport présente un contrôle technique de conformité au format Factur-X et aux règles de gestion EN 16931 et françaises. Il ne constitue ni un conseil juridique ou fiscal, ni une garantie d'acceptation par une plateforme agréée. La responsabilité réglementaire finale incombe à l'entreprise émettrice et à sa plateforme agréée.",
      72,
    ),
  );
  out.push(RULE);

  return out.join('\n');
}

/** Filename stem derived from the analysed file, so several reports stay distinguishable. */
export function reportFilename(result: AnalysisDto, extension: string): string {
  const stem =
    result.filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-') || 'facture';
  const date = new Date().toISOString().slice(0, 10);
  return `rapport-validation-${stem}-${date}.${extension}`;
}

/** Triggers a browser download from an in-memory string. Never touches the network. */
export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoking immediately can cancel the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
