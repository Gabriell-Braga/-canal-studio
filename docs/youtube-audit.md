# Auditoria da API do YouTube: passo a passo

Sem a auditoria, todo vídeo enviado pela API fica travado como privado. Este guia junta tudo o que o formulário pede. As respostas estão em inglês porque a equipe do Google lê em inglês.

## 1. Antes do formulário (uma vez)

1. **Publicar as páginas.** No GitHub, abra o repositório → **Settings → Pages**. Em *Build and deployment*, escolha **Deploy from a branch**, branch `main`, pasta `/docs`, e salve. Em 1 ou 2 minutos as páginas ficam no ar:
   - Página inicial: `https://gabriell-braga.github.io/-canal-studio/`
   - Política de privacidade: `https://gabriell-braga.github.io/-canal-studio/privacy.html`
2. **E-mail de contato.** Em `docs/privacy.html`, troque as duas ocorrências de `CONTACT_EMAIL` pelo e-mail de suporte que você usa na tela de consentimento OAuth.
3. **Tela de consentimento OAuth** (Google Cloud → *Google Auth Platform*):
   - *Branding*: preencha a página inicial e a política de privacidade com os links acima.
   - *Público-alvo*: clique em **Publicar app** (status "Em produção"). Reconecte cada canal uma vez no Canal Studio. O login para de vencer a cada 7 dias.
   - Não precisa pedir a verificação do app. O aviso "app não verificado" só aparece para você, e uso próprio é permitido.
4. **Gravar o vídeo de tela** (roteiro na seção 3) e subir no YouTube como **não listado**.

## 2. Formulário

Abra o formulário **YouTube API Services – Audit and Quota Extension Form**: `https://support.google.com/youtube/contact/yt_api_form`. Escolha a opção de auditoria (*I want to have my API client audited*). Os nomes dos campos mudam um pouco com o tempo; use a resposta do campo mais parecido.

**Project number:** o número do projeto (Google Cloud → página inicial do projeto, "Número do projeto").

**API client name:** `Canal Studio`

**Website / link to the API client:** `https://gabriell-braga.github.io/-canal-studio/`

**Privacy policy URL:** `https://gabriell-braga.github.io/-canal-studio/privacy.html`

**Who uses the API client?**
> Only me. Canal Studio is a private desktop app that I use to publish videos to my own YouTube channels. It has no other users, no public sign-up and no backend server.

**Describe your API client and how it uses YouTube API Services:**
> Canal Studio is a Windows desktop app that I built to produce documentary videos for my own YouTube channels. I choose the topics, the app drafts a script with AI and fact-checks it, and I review, edit and approve every script. The app then records the narration, builds the visuals from licensed stock footage and AI images, and renders the video on my computer. I watch the final video and approve it before anything is uploaded.
>
> The app uses the YouTube Data API v3 to upload the approved video (videos.insert) as private with a scheduled publish time (status.publishAt), with the "altered or synthetic content" disclosure set (status.containsSyntheticMedia). It then sets my custom thumbnail (thumbnails.set) and uploads English subtitles generated from the narration (captions.insert). It reads my own channel name and picture (channels.list). The YouTube Analytics API (reports.query) shows me the views, watch time, average view duration and subscribers gained of the videos the app uploaded.
>
> The app runs only on my computer. OAuth tokens are encrypted with Windows DPAPI and stored locally. No YouTube data is sent to any other service or shared with anyone.

**Which API services do you use?** YouTube Data API v3 e YouTube Analytics API.

**Which OAuth scopes do you request?**
> youtube.upload, youtube.force-ssl, youtube.readonly, yt-analytics.readonly

**Why do the uploaded videos need to be public?**
> The app schedules each approved video with status.publishAt so YouTube publishes it at my chosen time. Without the audit, every upload is locked as private and the schedule is ignored, so I have to publish each video by hand in YouTube Studio.

**Expected usage:**
> About 1 long video and 2 Shorts per day across my channels: around 3 to 6 uploads per day. The default quota of 10,000 units per day is enough; I am not asking for more quota.

**Link to a demo video:** o link do vídeo não listado da seção 3.

**How do you comply with the YouTube API Services Terms and Developer Policies?**
> Every video is reviewed and approved by me twice before upload: once as a script and once as the finished video. The app sets the altered or synthetic content disclosure on every upload, uses only stock media whose license allows this use and credits authors when the license requires it, and shows only my own channel's data to me. Users can revoke access in the app (Desconectar) or at myaccount.google.com/permissions, and the privacy policy explains what is stored and how to delete it.

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

- A resposta chega por e-mail, normalmente em semanas, às vezes em meses. Se pedirem ajustes, responda no mesmo e-mail e reenvie.
- Até lá, o app sobe os vídeos normalmente e avisa no log que ficaram privados. Publique ou agende cada um no YouTube Studio.
- Quando a auditoria for aprovada, marque **Configurações gerais → YouTube → "O projeto passou na auditoria da API do YouTube"**. O aviso some.
