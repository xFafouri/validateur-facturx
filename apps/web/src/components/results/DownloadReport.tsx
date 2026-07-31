'use client';

import { useState } from 'react';
import type { AnalysisDto } from '@facturx/core';
import { buildTextReport, downloadText, reportFilename } from '@/lib/report';

/**
 * Report download.
 *
 * Both formats are produced in the browser from data the page already has, so nothing is uploaded,
 * emailed or stored. Two formats because the two realistic users differ: an accountant forwards
 * the text to a client, an integrator feeds the JSON to whatever generated the bad invoice.
 */
export function DownloadReport({ result }: { result: AnalysisDto }) {
  const [downloaded, setDownloaded] = useState<'txt' | 'json' | null>(null);

  const handle = (format: 'txt' | 'json') => {
    if (format === 'txt') {
      downloadText(buildTextReport(result), reportFilename(result, 'txt'), 'text/plain');
    } else {
      downloadText(
        JSON.stringify(result, null, 2),
        reportFilename(result, 'json'),
        'application/json',
      );
    }
    setDownloaded(format);
  };

  return (
    <div className="rounded-lg border border-navy-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-navy-900">Conserver ce rapport</h3>
          <p className="mt-0.5 text-xs text-navy-600">
            Généré dans votre navigateur : aucune donnée n&apos;est envoyée ni conservée.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handle('txt')}
            className="rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm font-semibold text-navy-800 transition-colors hover:bg-navy-50"
          >
            Télécharger (.txt)
          </button>
          <button
            type="button"
            onClick={() => handle('json')}
            className="rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm font-semibold text-navy-800 transition-colors hover:bg-navy-50"
          >
            JSON
          </button>
        </div>
      </div>

      {downloaded && (
        <p role="status" className="mt-3 text-xs text-signal-ok">
          Rapport téléchargé ({downloaded === 'txt' ? 'texte' : 'JSON'}).
        </p>
      )}
    </div>
  );
}
