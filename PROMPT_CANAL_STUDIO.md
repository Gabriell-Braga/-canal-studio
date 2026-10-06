# Canal Studio — App Windows para produção de vídeos do YouTube

Você vai construir, do zero, um app desktop para Windows que produz vídeos longos para um canal "faceless" do YouTube em inglês, rodando tudo localmente e de graça. O usuário aprova o roteiro e o vídeo final; todo o resto é automático, em fila, com execução pesada em uma janela noturna.

Leia este documento inteiro antes de começar. Trabalhe em fases (seção 11), testando cada uma antes de seguir.

---

## 1. Ambiente do usuário

- Windows 10/11, 64 bits
- GPU: NVIDIA RTX 3060 **12 GB VRAM**
- RAM: 32 GB
- O usuário já tem várias ferramentas instaladas. **Sempre verifique antes de instalar.**
- Interface do app em **português (Brasil)**. Código, nomes de variáveis e conteúdo dos vídeos em **inglês**.

---

## 2. Regras para você (agente)

1. **Verifique antes de instalar.** Rode `node -v`, `npm -v`, `python --version`, `git --version`, `ffmpeg -version`, `ollama --version`, `nvidia-smi` e similares. Só instale o que faltar ou estiver desatualizado.
2. **Use `winget`** para instalar programas quando possível. Se precisar de privilégio de administrador ou de algo que você não consegue fazer, pare e me diga exatamente o que fazer.
3. **Peça confirmação antes de downloads acima de 2 GB** (modelos de IA), dizendo o tamanho aproximado.
4. **Me pergunte apenas o que for indispensável**: chaves de API, credenciais OAuth, caminho de instalações existentes (ex.: ComfyUI). Quando pedir algo, explique passo a passo onde eu consigo.
5. **Nunca coloque segredos no código.** Chaves ficam no banco local (tabela `settings`) ou em `.env` ignorado pelo git.
6. **Git desde o início.** Faça commit ao fim de cada fase com mensagem clara.
7. **Teste de verdade.** Ao terminar cada fase, rode o app e valide os critérios de aceite. Se algo falhar, corrija antes de avançar.
8. Ao final de cada fase, me dê um resumo curto: o que foi feito, como testar, o que vem a seguir.
9. Se algo deste documento estiver desatualizado (versão de biblioteca, comando, API), use a alternativa atual mais próxima e me avise.

---

## 3. Stack

| Camada | Tecnologia |
|---|---|
| App desktop | **Electron** + **Vite** + **React** + **TypeScript** (use `electron-vite` ou template equivalente) |
| UI | Tailwind CSS + componentes simples (shadcn/ui opcional) |
| Banco | **SQLite** via `better-sqlite3` (rodar `electron-rebuild` para o módulo nativo) + Drizzle ORM ou SQL puro |
| Roteiro (LLM local) | **Ollama** em `http://localhost:11434`, modelo padrão `qwen3:14b` (alternativa: `gemma3:12b`) |
| Voz | **Kokoro** (Apache 2.0) em um servidor Python |
| Legendas / timestamps | **faster-whisper** no mesmo servidor Python |
| Imagens IA | **ComfyUI** via API local (`http://127.0.0.1:8188`), modelo SDXL ou Flux Schnell |
| Vídeos de banco | **Pexels API** (gratuita) |
| Montagem e render | **Remotion** + FFmpeg |
| YouTube | `googleapis` (YouTube Data API v3 + YouTube Analytics API), OAuth com loopback local |
| Empacotamento | `electron-builder` gerando instalador NSIS `.exe` |

### Servidor Python (sidecar)

- Pasta `python/` com `venv` próprio, FastAPI + Uvicorn na porta `8765`.
- Endpoints: `GET /health`, `POST /tts` (texto, voz, velocidade → caminho do .wav), `POST /transcribe` (caminho do áudio → palavras com início/fim em segundos).
- O processo principal do Electron **inicia o servidor ao abrir o app e encerra ao fechar**.
- Kokoro pode exigir **espeak-ng** no Windows; instale se necessário.
- faster-whisper: tente CUDA (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`). Se der problema de DLL, use fallback automático para CPU com `compute_type="int8"` e modelo `small.en`. Isso deve ser configurável.

### Render do Remotion

Rode o render **em um processo Node separado** (script em `remotion/render.ts` chamado via `child_process`), não dentro do processo principal do Electron, para evitar problemas de bundle e permitir cancelar o render.

> Licença do Remotion: gratuita para indivíduos e empresas pequenas. Não precisa fazer nada, só registre isso no README.

---

## 4. Instalações (verifique e instale o que faltar)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.11
winget install Git.Git
winget install Gyan.FFmpeg
winget install Ollama.Ollama
```

Depois:

- `ollama pull qwen3:14b` (~9 GB, **pedir confirmação**).
- **ComfyUI:** pergunte se já tenho instalado e onde. Se não, baixe a versão portátil para NVIDIA do GitHub oficial (pedir confirmação). Modelo: SDXL base 1.0 ou Flux.1 Schnell em versão que caiba em 12 GB (fp8/GGUF). **Não use Flux.1 Dev** (licença restritiva para uso comercial do modelo).
- Python: crie o `venv` em `python/` e instale `fastapi uvicorn kokoro soundfile faster-whisper`.
- Kokoro e Whisper baixam pesos na primeira execução; faça um teste de aquecimento para baixar logo.

Crie um script `scripts/check-setup.ps1` que verifica tudo isso e mostra o que está OK e o que falta. O app também deve ter essa verificação na tela de Serviços.

---

## 5. Modelo de dados (SQLite)

**videos**
- `id`, `topic` (tema), `niche`, `status`, `title`, `description`, `tags` (JSON), `script_json` (JSON), `duration_target_min`
- `audio_path`, `video_path`, `thumbnail_paths` (JSON), `chosen_thumbnail`
- `scheduled_at` (data de publicação), `youtube_id`, `synthetic_content` (bool, divulgação de conteúdo alterado/sintético)
- `error_message`, `created_at`, `updated_at`

**scenes**
- `id`, `video_id`, `index`, `narration`, `visual_keywords`, `image_prompt`, `asset_type` (`stock_video` | `stock_photo` | `ai_image` | `ai_video`), `asset_path`, `start_sec`, `end_sec`, `locked` (o usuário escolheu manualmente; não regenerar)

**jobs**
- `id`, `video_id`, `type` (`script`, `audio`, `transcribe`, `scenes`, `render`, `thumbnail`, `metadata`, `upload`), `status` (`pending`, `running`, `done`, `failed`, `cancelled`), `priority`, `gpu` (bool), `run_mode` (`now` | `night`), `attempts`, `max_attempts` (padrão 3), `log`, `started_at`, `finished_at`

**settings** (chave/valor): prompts, voz, velocidade, modelo Ollama, janela noturna, chave Pexels, credenciais Google, slots de publicação, limite de vídeos por noite, estilo do template.

**logs**: `id`, `job_id`, `level`, `message`, `created_at`.

### Status do vídeo

```
TOPIC_QUEUED → SCRIPT_GENERATING → SCRIPT_REVIEW (aprovação humana)
→ PRODUCTION_QUEUED → AUDIO → SCENES → RENDERING → THUMBNAIL
→ FINAL_REVIEW (aprovação humana) → SCHEDULED → PUBLISHED
ERROR (em qualquer etapa, com "Tentar de novo a partir desta etapa")
```

---

## 6. Fila e modo madrugada (funcionalidade central)

O fluxo de uso ideal é:

1. Durante o dia, eu adiciono temas (um por um ou colando uma lista).
2. Clico em **"Gerar roteiros"**; os roteiros são gerados (tarefa leve, pode rodar na hora).
3. Reviso e **aprovo vários de uma vez** (seleção múltipla + "Aprovar selecionados"), ou edito antes de aprovar.
4. Os aprovados vão para `PRODUCTION_QUEUED` e a produção pesada roda na **janela noturna**.
5. De manhã, recebo uma notificação: "3 vídeos prontos para revisão final".
6. Aprovo os vídeos finais, que são agendados automaticamente nos próximos horários livres.

### Regras do worker

- Um **loop de agendamento** no processo principal checa a fila a cada 5 segundos.
- **Uma única tarefa de GPU por vez** (trava global). Tarefas sem GPU (metadata, upload) podem rodar em paralelo, no máximo 2.
- **Gestão de VRAM (crítico para 12 GB):**
  - Chamadas ao Ollama com `keep_alive: 0` para descarregar o modelo ao terminar.
  - Antes de usar o ComfyUI, garantir que o Ollama descarregou. Após o lote de imagens de um vídeo, chamar `POST /free` do ComfyUI (`unload_models: true, free_memory: true`).
  - Agrupar: gerar **todas as imagens de um vídeo** em sequência antes de passar para a próxima etapa.
- **Janela noturna** configurável (padrão 01:00–07:00). Tarefas com `run_mode = night` só começam dentro da janela. Depois do fim da janela, nenhuma tarefa nova começa; a que está rodando termina.
- Botões globais: **"Rodar agora"** (ignora a janela), **"Pausar fila"**, **"Retomar"**.
- **Limite por noite** configurável (padrão 3 vídeos).
- **Retentativas:** até 3 tentativas com espera crescente (1, 5, 15 min). Na falha final, o vídeo vai para `ERROR` com mensagem clara.
- **Recuperação de queda:** ao abrir o app, tarefas `running` voltam para `pending`.
- **Retomar etapa:** cada etapa é idempotente; se os arquivos de saída já existem e são válidos, pular.
- `powerSaveBlocker` ativo enquanto houver tarefa rodando, para o PC não suspender.
- Opção nas configurações: **"Iniciar com o Windows"** e minimizar para a bandeja.

### Agendamento de publicação

- Slots configuráveis (ex.: seg/qua/sex às 14:00, fuso `America/New_York`).
- Ao aprovar o vídeo final, ele recebe o próximo slot livre (editável).
- O upload pode acontecer à noite: enviar como privado com `publishAt` no slot, para o YouTube publicar sozinho.
- **Nunca publicar sem a aprovação final do usuário.**

---

## 7. Etapas em detalhe

### 7.1 Roteiro (Ollama)

Gerar JSON estrito (usar `format: "json"` do Ollama e validar com Zod; se inválido, tentar de novo até 2 vezes):

```json
{
  "title_options": ["...", "...", "..."],
  "hook": "...",
  "scenes": [
    { "narration": "...", "visual_keywords": "...", "image_prompt": "..." }
  ],
  "outro": "..."
}
```

Prompt padrão (editável em Configurações):

> You are a scriptwriter for a successful faceless YouTube documentary channel. Write a script about: {topic}. Target length: {minutes} minutes of narration (~150 words per minute).
> Rules: open with a strong hook in the first 15 seconds that creates curiosity; tell it as a story with tension and payoff; short, spoken-style sentences; no filler, no "in this video we will"; concrete facts, names, numbers and dates; add an open loop every 2–3 minutes to keep viewers watching; end with a satisfying conclusion and a soft call to subscribe.
> Split into scenes of 10–20 seconds of narration each. For each scene give: narration, visual_keywords (2–4 English words for stock footage search) and image_prompt (a detailed image-generation prompt, documentary style, no text in image).
> Return ONLY valid JSON matching the schema.

Também gerar, em chamada separada, uma **auto-revisão**: o modelo avalia o roteiro (gancho, ritmo, repetições, fatos duvidosos) e devolve uma lista curta de alertas, exibidos ao usuário na tela de revisão. Fatos duvidosos devem ficar destacados para eu checar.

### 7.2 Áudio (Kokoro)

- Gerar áudio **por cena**, depois concatenar com FFmpeg, com pausa curta configurável entre cenas.
- Voz e velocidade configuráveis, com botão "Ouvir amostra" nas Configurações.
- Normalizar volume (loudnorm, alvo -14 LUFS).

### 7.3 Transcrição (faster-whisper)

- Transcrever o áudio final com `word_timestamps=True`.
- Salvar as palavras com tempos, e calcular `start_sec`/`end_sec` de cada cena.

### 7.4 Cenas

Para cada cena (pular cenas `locked`):
1. Buscar na **Pexels API** vídeos com `visual_keywords` (orientação horizontal, HD). Baixar o melhor resultado que cubra a duração da cena; evitar repetir o mesmo clipe no vídeo.
2. Se não houver bom resultado, gerar imagem no **ComfyUI** com `image_prompt` (1344x768 ou similar).
3. Proporção configurável entre stock e IA.

Na tela de detalhe, cada cena tem: "Trocar por outro resultado", "Gerar imagem IA", "Escolher arquivo do PC" (que marca `locked`).

### 7.5 Render (Remotion)

Composição 1920x1080, 30 fps:
- Clipes de vídeo cortados no tempo da cena; imagens com **efeito Ken Burns** (zoom/pan lento, direção variada).
- Transições curtas (crossfade) entre cenas.
- **Legendas animadas palavra por palavra** (destaque na palavra atual), com estilo configurável e opção de desligar.
- Música de fundo de uma pasta local (`dados/musica/`), volume baixo (~10–15%), com fade in/out. O usuário coloca as músicas (Biblioteca de Áudio do YouTube).
- Ter **2 ou 3 variações de template** (fontes, cores, posição de legenda) para os vídeos não ficarem idênticos.
- Mostrar progresso do render na UI e permitir cancelar.

### 7.6 Thumbnail

- Usar `renderStill` do Remotion, 1280x720.
- Gerar **3 opções**: fundo (imagem IA ou frame forte do vídeo) + texto curto de impacto (2–4 palavras, gerado pelo LLM) em fonte grande e contorno.
- Na revisão final eu escolho uma.

### 7.7 Metadados

- LLM gera: título final (a partir das opções, até 70 caracteres), descrição com capítulos (timestamps das cenas agrupadas), 10–15 tags.
- Tudo editável na revisão final.

### 7.8 YouTube

- OAuth com servidor de loopback local; guardar o refresh token criptografado (`safeStorage` do Electron).
- Upload com `videos.insert` (privado + `publishAt`), depois `thumbnails.set`.
- Marcar a divulgação de conteúdo sintético quando `synthetic_content` for verdadeiro (verificar o campo atual na API; se não existir via API, avisar na UI para marcar no YouTube Studio).
- **Avisos ao usuário (mostrar na tela de Canal):**
  - A cota padrão da API é limitada (~6 uploads/dia). Mostrar a cota estimada usada.
  - Projetos de API não verificados têm uploads travados como privados até passar pela auditoria do Google. Explicar isso no guia de configuração.
- Analytics: views, tempo de exibição, duração média de visualização, CTR de impressões (se disponível), inscritos ganhos, por vídeo, atualizado sob demanda e 1x por dia.

---

## 8. Telas

1. **Produção (início):** quadro Kanban com colunas por status. Cards que esperam aprovação ficam destacados. Topo: campo "Adicionar temas" (aceita lista colada, um por linha), botão "Gerar roteiros", contadores.
2. **Revisão de roteiros:** lista dos roteiros em `SCRIPT_REVIEW` com checkbox, prévia, alertas da auto-revisão, botões "Aprovar selecionados", "Refazer", "Editar".
3. **Detalhe do vídeo:** abas Roteiro (edição por cena) / Áudio (player) / Cenas (grade de miniaturas com ações) / Vídeo (player do resultado) / Publicação (thumbnails, título, descrição, tags, data, checkbox de conteúdo sintético). Botões: Aprovar, Refazer a partir desta etapa.
4. **Fila e Worker:** tarefas atuais e próximas, logs em tempo real, uso de VRAM (via `nvidia-smi`), status da janela noturna, botões Rodar agora / Pausar / Retomar.
5. **Canal:** métricas do YouTube por vídeo e totais.
6. **Serviços:** status de Ollama, ComfyUI, servidor Python, FFmpeg, GPU, com botões para iniciar e testar.
7. **Configurações:** prompts, modelo do Ollama, voz, template, janela noturna, limite por noite, slots de publicação, chaves de API, pasta de dados, iniciar com o Windows.

Notificações do Windows: roteiros prontos para revisão, vídeos prontos para revisão final, erros, resumo da manhã.

---

## 9. Estrutura de pastas

```
canal-studio/
├─ electron/            processo principal: banco, fila, IPC, serviços
│  ├─ db/
│  ├─ queue/            agendador, trava de GPU, janela noturna
│  ├─ steps/            script, audio, transcribe, scenes, render, thumbnail, metadata, upload
│  └─ services/         clientes de Ollama, ComfyUI, Python, Pexels, YouTube
├─ src/                 interface React
├─ remotion/            composições do vídeo e da thumbnail + render.ts
├─ python/              servidor FastAPI (Kokoro + faster-whisper)
├─ scripts/             check-setup.ps1 e utilitários
└─ dados/               (fora do git) banco, projetos/{id}/, musica/
```

Cada etapa em `steps/` implementa a mesma interface (`run(videoId, ctx)`), para eu poder trocar uma etapa (ex.: roteiro via API paga) sem mexer no resto.

---

## 10. Qualidade e regras do YouTube

- O app existe para **acelerar** a produção, não para publicar em massa sem revisão. As duas aprovações humanas são obrigatórias e não podem ser desativadas.
- Variedade entre vídeos (templates, ritmos, estrutura) para evitar padrão repetitivo.
- No README, incluir uma seção sobre a política de conteúdo inautêntico/repetitivo do YouTube e sobre licenças: conferir a licença de cada modelo usado para uso comercial.

---

## 11. Fases de entrega

**Fase 0 — Ambiente.** Verificar/instalar dependências, `check-setup.ps1`, criar o projeto Electron vazio rodando.
*Aceite:* o app abre, a tela de Serviços mostra o status de tudo.

**Fase 1 — Roteiros.** Banco, Kanban, adicionar temas, geração de roteiro via Ollama, tela de revisão com aprovação em lote e edição.
*Aceite:* adiciono 3 temas, gero 3 roteiros, aprovo os 3 de uma vez.

**Fase 2 — Fila e worker.** Agendador, trava de GPU, janela noturna, retentativas, recuperação de queda, bandeja, notificações, powerSaveBlocker.
*Aceite:* com janela configurada para daqui a 2 minutos, as tarefas esperam e começam sozinhas; fechar e reabrir o app no meio não perde nada.

**Fase 3 — Áudio e legendas.** Servidor Python, Kokoro, faster-whisper, tempos por cena.
*Aceite:* um roteiro aprovado vira um .wav normalizado com tempos por palavra salvos.

**Fase 4 — Cenas e render.** Pexels, ComfyUI, gestão de VRAM, Remotion com Ken Burns, legendas e música, 2 templates.
*Aceite:* um vídeo completo de ~8–10 min é renderizado à noite sem intervenção.

**Fase 5 — Revisão final e thumbnails.** Detalhe do vídeo, troca de cenas, 3 thumbnails, metadados.
*Aceite:* consigo trocar uma cena, re-renderizar e aprovar.

**Fase 6 — YouTube.** OAuth, upload agendado, thumbnail, analytics, guia de configuração do Google Cloud passo a passo.
*Aceite:* um vídeo aprovado é enviado como privado com data de publicação.

**Fase 7 — Empacotamento.** Instalador `.exe` com electron-builder, README completo (instalação, uso diário, solução de problemas).

Comece pela Fase 0. Me pergunte o que precisar.
