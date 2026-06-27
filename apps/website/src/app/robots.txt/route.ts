export function GET() {
  const body = `# *\n` +
    `User-agent: *\n` +
    `Allow: /\n` +
    `\n` +
    `# Sitemaps\n` +
    `Sitemap: https://stuard.ai/sitemap.xml\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}


