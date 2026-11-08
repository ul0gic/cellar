const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export interface DocumentParts {
  readonly title: string;
  readonly assetBase: string;
  readonly version: string;
  readonly refresh: boolean;
  readonly bodyAttributes: string;
  readonly main: string;
  readonly script: boolean;
}

export const NOSCRIPT_REFRESH_SECONDS = 25;

export function renderDocument(parts: DocumentParts): string {
  const refresh = parts.refresh
    ? `<noscript><meta http-equiv="refresh" content="${NOSCRIPT_REFRESH_SECONDS}"></noscript>`
    : '';
  const script = parts.script
    ? `<script src="${parts.assetBase}/display-${escapeHtml(parts.version)}.js"></script>`
    : '';
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(parts.title)}</title>
<link rel="stylesheet" href="${parts.assetBase}/display-${escapeHtml(parts.version)}.css">
<link rel="stylesheet" href="${parts.assetBase}/display-extra-${escapeHtml(parts.version)}.css">
${refresh}
</head>
<body${parts.bodyAttributes}>
<main class="card">${parts.main}</main>
${script}
</body>
</html>
`;
}
