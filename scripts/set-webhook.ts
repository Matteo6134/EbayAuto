async function main() {
  const url = process.argv[2];
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!url) {
    console.error('Uso: npm run set-webhook -- <url-pubblico-completo>');
    process.exit(1);
  }
  if (!token || !secret) {
    console.error('TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET devono essere impostati nell\'ambiente.');
    process.exit(1);
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${url}/api/telegram/webhook`, secret_token: secret }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  if (!data.ok) {
    process.exit(1);
  }
}

main();
