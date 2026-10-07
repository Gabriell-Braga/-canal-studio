# Auditoria da API do YouTube: passo a passo

Sem a auditoria, todo vídeo enviado pela API fica travado como privado. Este guia junta tudo o que o formulário pede. As respostas estão em inglês porque a equipe do Google lê em inglês.

## 1. Antes do formulário (uma vez)

1. **Publicar as páginas.** No GitHub, abra o repositório → **Settings → Pages**. Em *Build and deployment*, escolha **Deploy from a branch**, branch `main`, pasta `/docs`, e salve. Em 1 ou 2 minutos as páginas ficam no ar:
   - Página inicial: `https://gabriell-braga.github.io/-canal-studio/`
   - Política de privacidade: `https://gabriell-braga.github.io/-canal-studio/privacy.html`
2. **E-mail de contato.** A política de privacidade usa `gabribragandrade@gmail.com`, o mesmo e-mail da tela de consentimento OAuth.
3. **Tela de consentimento OAuth** (Google Cloud → *Google Auth Platform*):
   - *Branding*: preencha a página inicial, a política de privacidade e os termos de serviço (`https://gabriell-braga.github.io/-canal-studio/terms.html`).
   - *Público-alvo*: clique em **Publicar app** (status "Em produção"). Reconecte cada canal uma vez no Canal Studio. O login para de vencer a cada 7 dias.
   - Não precisa pedir a verificação do app. O aviso "app não verificado" só aparece para você, e uso próprio é permitido.
4. **Gravar o vídeo de tela** (roteiro na seção 3) e subir no YouTube como **não listado**. O formulário não tem campo de vídeo: o link vai nas instruções de acesso, e as capturas saem do vídeo.

## 2. Formulário

Entre no Google com a conta principal (`gabribragandrade@gmail.com`), dona do projeto, e abra `https://support.google.com/youtube/contact/yt_api_form`. O formulário tem 5 secções. As respostas de texto estão em inglês porque a equipe do Google lê em inglês.

### Arquivos para anexar

Junte tudo numa pasta antes de começar (sugestão: `Documentos\auditoria-youtube`).

| Arquivo | Como conseguir |
|---|---|
| `1-pagina-inicial.png` | Página inicial com os links da política e dos termos (já gerado) |
| `2-politica-privacidade.png` | Política de privacidade inteira (já gerado) |
| `3-termos-de-servico.png` | Termos de serviço inteiros (já gerado) |
| `4-evidencias.pdf` | Um PDF com as capturas abaixo, nesta ordem |

Capturas do `4-evidencias.pdf` (tire do vídeo de tela ou com Win + Shift + S):

1. Tela de consentimento do Google com os 4 escopos e a barra de endereço.
2. Tela **YouTube** do app com o canal conectado e o botão *Desconectar*.
3. `myaccount.google.com/permissions` mostrando o Canal Studio com acesso (revogação).
4. Aprovação final de um vídeo com "conteúdo alterado/sintético" marcado.
5. Fila de upload com o vídeo enviado.
6. O vídeo no YouTube Studio com título, thumbnail e legendas.
7. Métricas do canal na tela **YouTube**.

### Secção 1: tipo de pedido

- **Compliance audit to request additional quota** (auditoria para pedir quota adicional). É a opção para quem nunca passou por auditoria. A outra opção é só para quem já foi auditado.

### Secção 2: organização e contactos

| Campo | Resposta |
|---|---|
| Pedido feito | **As individual person** (pessoa individual) |
| Full name | seu nome completo |
| Organization legal name | `self` |
| Parent company | `self` |
| Main website | `https://gabriell-braga.github.io/-canal-studio/` |
| País / morada / cidade / estado / CEP | sua morada real no Brasil |
| Category | **Tools and Services for Content Creators** |
| Organization size/type | **Independent developer/sole proprietor** |
| Primary contact | seu nome e `gabribragandrade@gmail.com` |
| Technical contact | marque **Same as primary contact** |
| Business contact | marque **Same as primary contact** |

### Secção 3: modelo de negócio e contactos da Google

**Describe your organization's work as it relates to YouTube:**
> I am an independent developer and YouTube creator. Canal Studio is a private Windows desktop app that I built for myself to produce documentary videos for my own YouTube channels. It has no other users, no public sign-up and no backend server.
>
> I choose the topics, the app drafts a script with AI and fact-checks it, and I review, edit and approve every script. The app then records the narration, builds the visuals from licensed stock footage and AI images, and renders the video on my computer. I watch the final video and approve it before anything is uploaded.
>
> The app uses the YouTube Data API v3 to upload the approved video as private with a scheduled publish time (status.publishAt), with the "altered or synthetic content" disclosure set (status.containsSyntheticMedia). It then sets my custom thumbnail (thumbnails.set), uploads English subtitles generated from the narration (captions.insert) and reads my own channel name and picture (channels.list). The YouTube Analytics API shows me the views, watch time, average view duration and subscribers gained of the videos the app uploaded.
>
> The value for me: one reviewed workflow from idea to scheduled upload, with a human approval at every step. I am requesting this audit because unaudited projects have every upload locked as private, so the scheduled publish time is ignored. The default quota is enough; I am not asking for more quota.

| Campo | Resposta |
|---|---|
| Público-alvo | **Utilizadores internos** (só esta) |
| Monetização | **No-cost service** (serviço gratuito) |
| Representante da Google | **I have no Google representative** |
| Como conheceu a API | **Google Developers documentation** |
| Content Owner IDs | deixe vazio |
| Google Ads Client IDs | deixe vazio |

### Secção 4: cliente da API

| Campo | Resposta |
|---|---|
| API client name | `Canal Studio` |
| Nome contém "YouTube" | **No** |
| Primary access URL | `https://gabriell-braga.github.io/-canal-studio/` |
| Privacy policy URL | `https://gabriell-braga.github.io/-canal-studio/privacy.html` |
| Terms of service URL | `https://gabriell-braga.github.io/-canal-studio/terms.html` |
| Acesso público | **No** |
| Demo account username / password / login URL | deixe vazio (se for obrigatório, escreva `N/A`) |
| Confirmação das credenciais | marque |

**Special access instructions:**
> Canal Studio is a private Windows desktop app with no web login and no accounts, so there is no demo account. It runs only on my computer and signs in with Google OAuth to my own channel. A screencast of the full flow (OAuth consent, script review, final approval, upload, channel statistics and revoking access) is here: <LINK DO VÍDEO NÃO LISTADO>. Screenshots are attached in the compliance evidence.

### Secção 5: casos de uso e quota

| Campo | Resposta |
|---|---|
| Number of projects | **1** |
| Google Cloud project number | `572974966748` |
| Use case categories | **Video uploading and account management** e **Internal company tool** |
| OAuth 2.0 login | **Yes** |
| Derived metrics and data storage | marque |
| Expected API usage | **Less than 1,000 requests/day** |
| Privacy policy screenshots | `2-politica-privacidade.png` |
| Homepage screenshot | `1-pagina-inicial.png` |
| Terms of service | `3-termos-de-servico.png` |
| Conditional evidence | `4-evidencias.pdf` |
| Endpoints | `youtube.videos.insert`, `youtube.thumbnails.set`, `youtube.captions.insert`, `youtube.channels.list` |
| Total quota | **No change / Default quota (10,000 quota points)** |

Ao marcar `youtube.videos.insert`, o formulário pede uma quota própria:

| Campo | Resposta |
|---|---|
| Total daily quota | `100` |
| Maximum per minute | `2` |

**Justification:**
> I upload about 1 long video and 2 Shorts per day across my own channels, so 3 to 6 videos.insert calls per day. The default allocation is enough and I am not asking for more. I am submitting this audit only so that uploads are no longer locked as private and the scheduled publish time (status.publishAt) works. Every video is reviewed and approved by me before upload and carries the altered or synthetic content disclosure.

Se o formulário pedir anexos extras, use os arquivos de `docs/auditoria/` (gere de novo com `node scripts/render-audit.mjs` depois de editar os `.html`):

| Campo | Arquivo |
|---|---|
| Diagrama de arquitetura | `docs/auditoria/arquitetura.png` |
| Diagramas de fluxo do utilizador | `docs/auditoria/fluxo.png` |
| Outros materiais de apoio | `docs/auditoria/apoio.pdf` |

Revise tudo e clique em **Enviar**. Guarde o e-mail de confirmação.

## 3. Roteiro do vídeo de tela (3 a 5 minutos)

Grave a tela inteira com o **Win + Alt + R** (Xbox Game Bar) ou o OBS. Fale em inglês ou só mostre a tela; legendas em inglês ajudam. Mostre a barra de endereço do navegador durante o login.

1. **Abertura (15 s).** O app aberto na tela Produção. Diga: "This is Canal Studio, a private desktop app I use to publish videos to my own YouTube channel."
2. **Login OAuth (45 s).** Na tela **YouTube**, clique em *Desconectar* e depois em *Conectar YouTube*. Mostre a tela de consentimento do Google com os escopos pedidos e aceite. Volte ao app conectado.
3. **Revisão humana (45 s).** Tela **Revisão de roteiros**: abra um roteiro, mostre os alertas de checagem de fatos e aprove.
4. **Aprovação final (30 s).** Abra um vídeo pronto, dê play alguns segundos e clique em aprovar. Mostre a opção "conteúdo alterado/sintético" marcada.
5. **Upload (60 s).** Mostre o envio na fila e o vídeo aparecendo no YouTube Studio com título, descrição, thumbnail e legendas.
6. **Dados do canal (30 s).** Volte à tela **YouTube** e mostre as métricas do próprio canal.
7. **Revogar acesso (15 s).** Clique em *Desconectar*. Mostre que a conta sai do app.

Não mostre o *Client secret* nem os tokens na gravação.

## 4. Depois do envio

Formulário enviado em 7 de outubro de 2026.

- A resposta chega por e-mail, normalmente em semanas, às vezes em meses. Se pedirem ajustes, responda no mesmo e-mail e reenvie.
- Até lá, o app sobe os vídeos normalmente e avisa no log que ficaram privados. Publique ou agende cada um no YouTube Studio.
- Quando a auditoria for aprovada, marque **Configurações gerais → YouTube → "O projeto passou na auditoria da API do YouTube"**. O aviso some.
