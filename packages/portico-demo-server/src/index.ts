import App from "./app";
import { getConfig } from "./config";
import { Store } from "./data";

export type * from "./message";

async function main() {
  const config = getConfig();
  const store = Store.fromConfig(config);
  const app = App({ config, store });

  if (config.server.host) {
    app.listen(config.server.port, config.server.host, () => {
      console.log(
        `Listening on http://${config.server.host}:${config.server.port}`
      );
    });
  } else {
    app.listen(config.server.port, () => {
      console.log(`Listening on HTTP port ${config.server.port}`);
    });
  }
}

await main();
