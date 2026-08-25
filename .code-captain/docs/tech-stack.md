# Tech Stack: storybook-storefront

## Core
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Frontend | React | 19.2 | SPA with React Router v7 |
| Styling | Tailwind CSS | 4.3 | Via Vite plugin, dark mode support |
| Build (client) | Vite | 8.0 | With @vitejs/plugin-react |
| Backend | Express | 4.21 | REST API, JSON body parsing |
| Runtime | tsx | 4.19 | TypeScript execution (dev + prod) |
| ORM | Prisma | 5.22 | SQLite via @prisma/client |
| AI | Anthropic SDK | 0.39 | Claude API for story generation |
| Validation | Zod | 3.23 | Shared schemas, request/response validation |
| Language | TypeScript | 7.0 | Native (Go) compiler. Across all workspaces; `tsc` ships per-platform binaries as optional deps |
| Monorepo | npm workspaces | — | shared, server, client, e2e |

## Dependencies (top 15 by importance)
| Package | Version | Purpose |
|---------|---------|---------|
| react | ^19.2.6 | UI framework |
| react-dom | ^19.2.6 | React DOM renderer |
| react-router-dom | ^7.15.1 | Client-side routing |
| tailwindcss | ^4.3.0 | Utility-first CSS |
| lucide-react | ^1.16.0 | Icon library |
| express | ^4.21.2 | HTTP server |
| @anthropic-ai/sdk | ^0.39.0 | Claude AI integration |
| @prisma/client | ^5.22.0 | Database ORM |
| zod | ^3.23.8 | Schema validation (shared pkg) |
| cors | ^2.8.5 | Cross-origin middleware |
| multer | ^2.1.1 | File upload handling |
| uuid | ^11.1.0 | UUID generation |
| jsonrepair | ^3.14.0 | Repair malformed AI JSON output |
| dotenv | ^16.4.7 | Environment variable loading |
| concurrently | ^9.1.0 | Parallel script runner |

## Dev Tooling
| Tool | Config File | Purpose |
|------|------------|---------|
| Vitest | (inline in package.json) | Unit/integration testing (server + client) |
| Supertest | — | HTTP assertion library for server tests |
| React Testing Library | — | Component testing for client |
| Playwright | e2e/playwright.config.ts | End-to-end browser testing |
| ESLint | client/eslint.config.js | Linting (client only) |
| TypeScript | client/tsconfig.json, server/tsconfig.json | Type checking |

## Infrastructure
- Build: Vite (client), tsx runtime (server — no compile step)
- CI/CD: None configured (demo project)
- Container: None
- Database: SQLite (dev.db file, Prisma migrations)
- Static files: Express static serving for /illustrations and /uploads
