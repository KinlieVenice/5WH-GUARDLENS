// Production/dev entrypoint for the HTTP API: build the app and start listening.
// (Tests skip this file and call createApp() directly.)
import { createApp } from "./app.js";
import { env } from "./config/env.js";
const app = createApp();
app.listen(env.PORT, () => console.log(`api listening on :${env.PORT} (base domain ${env.APP_BASE_DOMAIN})`));
