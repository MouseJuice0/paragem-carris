// 构建脚本 —— 不是App运行时代码,是"打包前"跑一次用的工具。
// 作用:从 Carris Metropolitana 官方 API 拉取全量站点(约6.8MB),
// 只留搜索用得到的字段,生成体积小得多的 stops-index.json 放进项目里随App一起部署。
//
// 用法: node scripts/build-stops-index.mjs
//
// 什么时候需要重跑:Carris 官方新增/调整站点的时候(不频繁,几个月跑一次即可,
// 不需要每次开发都跑)。跑完记得把新的 stops-index.json 一起提交、部署。

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API_URL = "https://api.carrismetropolitana.pt/v2/stops";
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "stops-index.json");

async function main() {
  console.log("正在从 Carris Metropolitana API 拉取全量站点…");
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error("拉取失败: HTTP " + res.status);
  }
  const stops = await res.json();
  if (!Array.isArray(stops) || stops.length === 0) {
    throw new Error("API返回的站点列表是空的,不正常,停止写入,先检查API本身");
  }

  const trimmed = stops.map((s) => ({
    id: s.id,
    name: s.long_name || s.short_name || "",
    lat: Math.round(s.lat * 1e5) / 1e5,
    lon: Math.round(s.lon * 1e5) / 1e5,
    muni: s.municipality_id || null
  }));

  await writeFile(OUT_PATH, JSON.stringify(trimmed), "utf8");
  console.log("写入完成:", OUT_PATH);
  console.log("站点总数:", trimmed.length);
}

main().catch((err) => {
  console.error("构建失败:", err.message);
  process.exit(1);
});
