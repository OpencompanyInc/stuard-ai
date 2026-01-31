import "dotenv/config";

type Args = {
  send: boolean;
  to?: string;
  text?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { send: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--send") args.send = true;
    else if (a === "--to") args.to = argv[i + 1];
    else if (a === "--text") args.text = argv[i + 1];
  }
  return args;
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return trimmed;
}

async function main() {
  const { send, to: toArg, text: textArg } = parseArgs(process.argv.slice(2));

  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM;

  const to = normalizePhone(toArg ?? process.env.TELNYX_TO ?? "+16143809607");
  const text = textArg ?? process.env.TELNYX_TEXT ?? "Test message from StuardAI";

  if (!apiKey) throw new Error("Missing TELNYX_API_KEY");
  if (!from) throw new Error("Missing TELNYX_FROM (a Telnyx phone number like +1...)");

  if (!send) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          dryRun: true,
          message: "Dry run. Pass --send to actually send the SMS.",
          request: { from, to, text }
        },
        null,
        2
      ) + "\n"
    );
    process.exit(1);
  }

  const resp = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to, text })
  });

  const bodyText = await resp.text();

  if (!resp.ok) {
    throw new Error(`Telnyx error ${resp.status}: ${bodyText}`);
  }

  process.stdout.write(bodyText + "\n");
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + "\n");
  process.exit(1);
});
