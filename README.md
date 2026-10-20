# Thaís Alam Concept Salon

Site com Início, Galeria e Agendamento, painel protegido de solicitações em `/admin`, banco SQLite e integração opcional com WhatsApp Business Cloud API da Meta. **Node.js 24+**, sem dependências npm de produção. As dependências de desenvolvimento PGlite e esbuild validam o SQL PostgreSQL e os bundles das Functions.

## Netlify + Supabase (modo recomendado para publicar)

O projeto agora inclui Netlify Functions, banco persistente no Supabase e sessões no Postgres. Para um site já publicado, aplique a atualização em [ATUALIZAR-SITUACAO.md](ATUALIZAR-SITUACAO.md). Siga [DEPLOY-NETLIFY.md](DEPLOY-NETLIFY.md) para criar o Supabase e configurar a Netlify. O pacote anterior não incluía essa adaptação.

```sh
npm ci
npm run check
npm test
npm run check:netlify
npm run build:netlify
```

Para prévia local do mesmo handler: `npm run dev:cloud`, com Supabase e variáveis configurados. Para preparar todos os arquivos-fonte: `npm run package:netlify`. A Netlify deve importar pelo Git para executar o build e publicar as Functions; upload estático não ativa o backend. O fluxo descrito abaixo com SQLite continua disponível para desenvolvimento local; a Netlify não usa esse arquivo.


## Demonstração antes da contratação

```sh
npm run demo
```

Gera `demo.html`, um arquivo único com formulário e painel de teste. Abra no navegador, escolha Agendamento, preencha dados fictícios e clique em **Ver meu pedido no painel de teste**. A demonstração guarda dados apenas nesse navegador (`localStorage`, ou memória se o navegador não permitir persistência). A faixa de demonstração fica visível. Não usa o servidor nem o banco SQLite, não faz reservas e não envia WhatsApp. Não use dados de clientes nela. **Limpar teste** remove os dados locais.

Esse adaptador não é carregado pelo site de produção. Os testes de backend e de envio usam o servidor e SQLite reais, com dados temporários e uma API da Meta simulada nos testes.

## Executar a versão com servidor

```sh
npm run dev
```

A porta padrão é `3000` (configurável por `PORT`). O servidor cria o banco e as tabelas automaticamente em `data/agendamentos.sqlite`. `DATABASE_PATH` aponta para outro arquivo, de preferência absoluto. Scripts de inicialização e criação de senha leem `.env` quando existente; variáveis já injetadas na hospedagem têm precedência. Use `.env.example` como referência e nunca publique `.env`, senhas, tokens ou o banco.

### Acesso da equipe e teste completo

```sh
npm run admin:setup
# Defina uma senha de pelo menos 12 caracteres no terminal; ela não será exibida.
npm start
```

Se o servidor já estava aberto, reinicie após cadastrar a senha. A senha é salva como hash scrypt com salt em `data/admin-auth.json` (ou `ADMIN_AUTH_FILE`), fora dos arquivos públicos. Também é possível usar uma variável secreta `ADMIN_PASSWORD` na hospedagem em vez do cadastro em arquivo. Para mudar a senha em arquivo: `npm run admin:setup -- --alterar` e reinicie.

1. No domínio em que o servidor estiver publicado, abra `/#agendamento`.
2. Envie nome, telefone com DDD, data e horário. A autorização de contato inclui o aviso transacional por WhatsApp.
3. Guarde o protocolo `TA-…` recebido.
4. Abra `/admin`, entre com a senha da equipe e procure esse protocolo. O painel mostra nome, telefone, data, horário, observações e situação do aviso de WhatsApp. A aba **Agenda do dia** mostra os clientes por horário e permite bloquear ou liberar vagas. A aba **Pedidos do site** tem busca, filtros, paginação e atualização automática a cada 30 segundos. Em **Ver pedido**, a equipe pode escolher a situação e clicar **Salvar situação**. Estão disponíveis Aguardando contato, Em contato, Confirmado, Reagendar, Concluído e Cancelado; alterar a situação não dispara mensagens. **Reagendar pelo WhatsApp** abre a conversa com o cliente; em **Registrar nova data e hora**, salve o novo atendimento depois de combinar. O protocolo é mantido e o histórico registra a mudança.
5. Em **Ver pedido**, consulte os detalhes e, se desejar, abra uma conversa manual com o cliente. O clique não envia mensagem nem confirma o atendimento sozinho.

Não há senha padrão ou acesso público aos dados. Sem senha configurada, o painel permanece bloqueado. As sessões expiram em 8 horas e são encerradas no reinício. Defina `PUBLIC_ORIGIN` com o domínio HTTPS completo ao hospedar (por exemplo, o domínio escolhido para o projeto); isso também ativa cookies seguros. As tentativas de login são limitadas.

## Horários de hora em hora

Agenda informada pelo solicitante:

- Segunda a sábado: abertura 09:00, fechamento 21:00. Preferências de 09:00–10:00 até 20:00–21:00.
- Domingo: abertura 14:00, fechamento 19:30. Preferências de 14:00–15:00 até 18:00–19:00. Não há janela 19:00–20:00 porque ultrapassaria o fechamento.

O formulário carrega os horários ao selecionar a data e não oferece horários passados no fuso `America/Sao_Paulo`. Pedidos podem ser feitos para hoje até os próximos 90 dias. O servidor repete a validação; alterar o HTML não permite solicitar horários fora da grade. Essa é uma janela de preferência de uma hora, não uma promessa de duração do serviço.

**A solicitação fica pendente.** A equipe combina o serviço e a duração e confirma ou propõe reagendamento. Solicitações pendentes para a mesma preferência podem coexistir até avaliação da equipe. A confirmação é manual e ocupa a janela na agenda única do salão; o servidor impede duas confirmações na mesma vaga. Horários bloqueados ou ocupados não aparecem no formulário e são recusados também na gravação. Veja [ATUALIZAR-AGENDA.md](ATUALIZAR-AGENDA.md) para atualizar um site existente.

## Aviso automático por WhatsApp (opcional, desligado)

O solicitante informou que os dados da Meta serão colocados se o site for contratado. A integração está preparada, mas `WHATSAPP_ENABLED=false` por padrão. Sem configuração, o pedido continua salvo e o painel informa **Não enviado — integração não configurada**. Nenhuma mensagem real foi enviada durante a implementação ou os testes.

Texto proposto para aprovação como template de utilidade na Meta, com **quatro variáveis numéricas no corpo, nesta ordem**:

> Olá, {{1}}! Recebemos sua solicitação {{2}} para {{3}} às {{4}} no Thaís Alam Concept Salon. Em alguns instantes, nossa equipe entrará em contato para confirmar o agendamento ou combinar um reagendamento.

Variáveis: nome, protocolo, data em DD/MM/AAAA e horário. Categoria/aprovação e eventual cobrança são gerenciadas pela Meta. O modelo efetivo precisa ter esse corpo/ordem de parâmetros; apenas informar o nome de um modelo com outra estrutura não basta. Como o cliente ainda não iniciou uma conversa no WhatsApp, o servidor usa template aprovado em vez de presumir uma janela livre para enviar texto.

Configure com segurança no servidor/hospedagem:

- `WHATSAPP_ACCESS_TOKEN`: token da conta autorizado a enviar mensagens. Não colocar no frontend, Git ou chat.
- `WHATSAPP_PHONE_NUMBER_ID`: ID do número remetente na Meta; não é o telefone do cliente ou o número em formato +55.
- `WHATSAPP_TEMPLATE_NAME`: nome exato do template aprovado com os quatro parâmetros acima.
- `WHATSAPP_TEMPLATE_LANGUAGE`: `pt_BR` por padrão, deve corresponder ao template aprovado.
- `WHATSAPP_GRAPH_VERSION`: `v23.0` por padrão; use uma versão suportada para a conta/implantação.
- `WHATSAPP_ENABLED=true`: ativar somente depois de configurar conta, token e template.

O servidor envia para `https://graph.facebook.com/<versão>/<phone-number-id>/messages`, com o telefone do cliente normalizado para 55 + DDD + número. A solicitação e o registro do aviso são gravados na mesma transação. Um trabalhador processa a fila sem atrasar o formulário.

Estados distintos: aguardando configuração, em fila, enviando, **aceito pela Meta**, falha, envio incerto ou expirado. Aceito pela Meta não prova entrega no aparelho: webhooks de entrega não foram implementados. Erros e interrupções ambíguas não geram reenvio automático, para evitar mensagens duplicadas. Avisos em fila por mais de uma hora expiram; pedidos antigos ou criados sem configuração não são enviados retroativamente. Falhas no aviso não removem o pedido. Consulte o painel e faça contato manual quando necessário.

Referências oficiais: [Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/), [modelos de mensagem](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/).

## Hospedagem e GitHub

**GitHub guarda o código; GitHub Pages só serve arquivos estáticos.** Para a Netlify com backend, use o modo Functions + Supabase descrito acima. A opção abaixo com SQLite é para hospedagem de servidor convencional, não para Functions. O Pages pode mostrar a demonstração local, mas não executa este servidor Node.js, SQLite ou os envios automáticos. Para usar o fluxo real, publique o projeto em um serviço com Node.js 24+ e volume persistente (ou adapte o banco para um serviço gerenciado).

```sh
npm run check
npm test
npm run build
```

O build gera a aplicação completa em `dist/`. Copie/execute o pacote nessa hospedagem, defina `DATABASE_PATH` para o volume persistente e `PUBLIC_ORIGIN` para o domínio HTTPS, cadastre a senha e execute `npm start`. Não rode várias réplicas independentes com cópias locais do SQLite. A publicação não foi feita e nenhuma hospedagem foi contratada automaticamente.

Os testes usam bancos temporários e envios simulados: persistência, migração sem perda, idempotência, autenticação, horário, origem, validação e falhas de WhatsApp. Dados de clientes e credenciais não entram no build ou no Git. O build não apaga o banco.

## Consulta via terminal

```sh
npm run agendamentos -- listar
npm run agendamentos -- status TA-PROTOCOLO em_contato
```

Execute na pasta correta e com o mesmo `DATABASE_PATH` do servidor. São listados os 100 pedidos mais recentes. Estados: pendente, em_contato, confirmado, reagendar, concluido e cancelado. A alteração pelo terminal não dispara mensagens.

## Conteúdo e operação

As fotos são referências ilustrativas do Unsplash, identificadas na página. Não representam o salão nem trabalhos da equipe. Substitua por fotos autorizadas antes de uma publicação oficial. Fontes Google Fonts têm alternativas de sistema. Não foram inventados serviços, preços, equipe ou depoimentos.

Os dados dos pedidos só são expostos por API autenticada. SQL usa parâmetros, cookies são HttpOnly/SameSite, arquivos públicos são permitidos explicitamente. Banco e arquivos de autenticação não são servidos por HTTP. O formulário tem limite básico de 20 tentativas/minuto por endereço de conexão; atrás de um proxy, clientes podem compartilhar esse limite. Configure o proxy conhecido e os controles operacionais da hospedagem, acesso da equipe, retenção e backups consistentes do SQLite antes de atender clientes reais.
