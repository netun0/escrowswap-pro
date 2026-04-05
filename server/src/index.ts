import { PORT } from "./config.js";
import { createApp } from "./app.js";

const app = await createApp();

app.listen(PORT, () => {
  console.log(`JudgeBuddy API listening on http://localhost:${PORT}`);
});
