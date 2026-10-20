# Atualizar a agenda e o reagendamento

Esta atualização é para o site que já está na Netlify com Supabase. Não precisa criar outro projeto nem trocar as chaves. O pacote não publica automaticamente: aplique o SQL primeiro e depois envie os arquivos ao GitHub.

## 1. Atualizar o banco que o site já usa

No painel do **Supabase → SQL Editor → New query**, cole todo o conteúdo de **supabase/migrations/003-agenda-reagendamento.sql** e clique em **Run**.

A migração funciona mesmo se a atualização 002 ainda não tiver sido aplicada. Pode reaplicar a 003: preserva pedidos, protocolos, notificações, sessões, bloqueios e histórico. Ela cria a agenda, atualiza as funções e mantém os dados acessíveis somente pelo backend autenticado. Para uma instalação nova, use `supabase/schema.sql`.

## 2. Atualizar os arquivos do GitHub

Extraia **atualizacao-agenda-reagendamento.zip**. Envie o conteúdo ao repositório que a Netlify já usa, mantendo as pastas. Não envie o ZIP como arquivo único.

Arquivos da aplicação incluídos:

- Na raiz: `admin.html`, `admin.css`, `admin.js`, `script.js`, `server.mjs`, `build.mjs`, `package.json`.
- Na pasta `cloud`: `api.mjs` e `store.mjs`.
- Na pasta `lib`: `agenda.mjs`, `agenda-sqlite.mjs`, `schedule.mjs`, `booking-status.mjs`, `booking-status-sqlite.mjs`, `bookings.mjs` e `admin.mjs`.
- Na pasta `supabase`: o esquema completo e as migrações 002 e 003.
- As pastas `scripts`, `tests` e `demo` também trazem os arquivos atualizados de verificação e demonstração.

Substitua as versões antigas e faça **Commit changes** na branch publicada (`main`). Preserve as demais pastas, os registros no Supabase e as variáveis já configuradas na Netlify. Espere o deploy ficar **Published**. Se o GitHub não iniciar o deploy, use **Netlify → Deploys → Trigger deploy → Deploy site**.

## 3. Usar a agenda

Abra **seu domínio/admin** e entre com a senha da equipe. O painel tem duas abas:

- **Agenda do dia:** escolha a data. Cada janela de uma hora mostra os pedidos daquele horário, os nomes dos clientes e suas situações. Clique no nome para abrir o pedido.
- **Pedidos do site:** lista completa, busca por nome/protocolo e filtros de situação.

**Bloquear:** escolha um horário disponível e clique em Bloquear. O motivo é opcional e fica visível apenas à equipe. Depois de salvar, o horário some do formulário público. Pedidos já recebidos continuam registrados; entre em contato com esses clientes para combinar outra opção.

**Disponibilizar:** em um horário bloqueado, clique em Disponibilizar e depois Liberar no site. Não é possível bloquear um atendimento confirmado/concluído: primeiro reagende ou cancele esse pedido.

A agenda é **única para todo o salão**, sem divisão por profissional. Pedidos pendentes, Em contato ou Reagendar não reservam uma vaga; podem aparecer juntos no mesmo horário. **Confirmado** ocupa a janela e impede outra confirmação na mesma vaga. Concluído também conserva a ocupação registrada. Cancelar ou marcar Reagendar libera a vaga anterior. Horários passados continuam visíveis no painel, sem botão para alterar disponibilidade.

Se existirem confirmações duplicadas anteriores à atualização, elas são preservadas e sinalizadas na agenda para a equipe resolver. A migração não cancela atendimentos por conta própria.

## 4. Reagendar um cliente

1. Na agenda, clique no nome do cliente; ou abra Ver pedido na lista.
2. Clique em **Reagendar pelo WhatsApp**. Abre a conversa com o número do cliente e um texto sugerido com o protocolo e horário atual. A equipe revisa e envia a mensagem no WhatsApp.
3. Depois de combinar, volte ao painel e clique em **Registrar nova data e hora**.
4. Escolha a nova data, um horário disponível e a situação após a conversa. Deixe **Confirmado com o cliente** somente se já combinaram.
5. Clique em **Salvar novo agendamento** e aguarde a confirmação de que foi salvo.

O protocolo continua igual, o histórico registra a mudança e a agenda mostra o cliente no novo horário. Se salvar como Confirmado, a nova vaga fica ocupada e a anterior é liberada. Salvar como Em contato/Reagendar registra a preferência sem reservar a nova vaga. O servidor rejeita horários bloqueados, ocupados, passados ou fora do expediente.

**Abrir o WhatsApp e salvar no painel não enviam mensagens automaticamente.** A integração automática da Meta continua desligada. O site não consegue saber se houve conversa no WhatsApp; a equipe registra o resultado manualmente.

## 5. Testar depois do deploy

Com dados fictícios e WhatsApp automático desligado:

1. Abra `/api/health`: deve ter `status: "ok"`, `backend: "netlify-supabase"` e `schemaVersion: 3`. Um 503 pede verificar a migração/configuração; não é instalação concluída.
2. Faça um pedido em `/#agendamento` para uma data futura e guarde o protocolo.
3. Em `/admin`, escolha a mesma data na Agenda do dia. Abra o cliente e salve como Confirmado.
4. Reabra o formulário público e escolha a data novamente. A vaga confirmada não deve aparecer.
5. Bloqueie outra vaga livre, recarregue o formulário e confira que desapareceu. Disponibilize a vaga e confira que voltou.
6. Reagende o cliente para outro horário, recarregue o painel e confira a mudança e o histórico. O formulário público deve liberar a vaga anterior e retirar a nova vaga confirmada.
7. Saia do painel e confira que é necessário entrar novamente para acessar a agenda e os pedidos.

Se outro membro da equipe salvar primeiro, o painel avisa do conflito e carrega o pedido atual. Confira antes de salvar de novo. Se a rede falhar, recarregue e verifique o estado real antes de repetir.

A implementação foi validada localmente com SQL PostgreSQL, SQLite e navegador. Não foram usados dados reais, enviadas mensagens ou feitas alterações/deploys nas contas de produção.
