# Роевой интеллект — учебные симуляции

Сайт: https://swarm-lab.tdhster.workers.dev/

Интерактивные симуляции в браузере: простые локальные правила агентов порождают сложное коллективное поведение.
Чистый HTML + CSS + JavaScript, без сборки и зависимостей.

| Проект | Что показывает | Статус |
|---|---|---|
| `boids/` | Стая: separation / alignment / cohesion, хищник, препятствия | готово |
| `ants/` | Муравьиная колония (ACO): феромоны, кратчайшая тропа | готово |
| `physarum/` | Слизевик: частицы с сенсорами строят транспортную сеть | готово |
| `pso/` | Рой частиц (PSO) ищет минимум тестовых функций | готово |
| `crowd/` | Толпа: модель социальных сил, эвакуация, полосы, конструктор плана | готово |

## Запуск локально

```sh
python3 -m http.server 8766
# http://localhost:8766/
```

## Выкладывание

Хостинг — Cloudflare Worker `swarm-lab` со статикой (`wrangler.jsonc`, папка `site/`).

- Автоматически: пуш в `main` → Cloudflare Workers Builds запускает `./make-site.sh` и `npx wrangler deploy`.
- Вручную: `npx wrangler login` (один раз), затем `./make-site.sh && npx wrangler deploy`.
- Проверка без выкладки: `./make-site.sh && npx wrangler deploy --dry-run`.

`make-site.sh` собирает `site/` без служебных файлов (`.git`, `CLAUDE.md`, `tools/` и т. п.).
Аналитика Cloudflare: `./make-site.sh <token>` (по умолчанию без неё).
