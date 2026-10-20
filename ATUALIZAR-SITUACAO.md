# Atualizar a situação dos pedidos no painel

> Este guia é da versão anterior. Para instalar também agenda e reagendamento, use **[ATUALIZAR-AGENDA.md](ATUALIZAR-AGENDA.md)** e as migrações 003 e 004, que incluem a compatibilidade com a 002 e a reserva desde o primeiro pedido.

Esta atualização adiciona a ação **Ver pedido → Situação do pedido → Salvar situação**.

Situações disponíveis: Aguardando contato, Em contato, Confirmado, Reagendar, Concluído e Cancelado. O pedido começa aguardando contato; a equipe decide a situação depois de conversar com o cliente. A mudança fica no Supabase, aparece na lista, nos filtros e nos contadores e continua depois de recarregar.

**Salvar situação não envia WhatsApp.** O botão de conversar com o cliente continua sendo uma ação separada. “Reagendar” registra a necessidade de combinar outra data; não muda a preferência de data/horário do pedido nem faz reserva automática.

## 1. Atualizar o banco antes de publicar o código

No projeto Supabase que o site já usa:

1. Abra **SQL Editor** e crie uma consulta.
2. Cole o conteúdo de `supabase/migrations/002-booking-status.sql`.
3. Clique em **Run**.

O script adiciona uma versão por pedido, amplia as situações aceitas e atualiza as funções do painel. Não apaga pedidos, protocolos, contatos, notificações ou sessões. Pode ser executado novamente sem perder registros. As permissões continuam restritas ao backend; nenhuma política pública é aberta.

Para uma instalação nova, `supabase/schema.sql` já contém essa atualização. Para o site existente, use a migração menor acima.

## 2. Atualizar o GitHub e aguardar o deploy

Extraia `atualizacao-situacao-admin.zip` e envie os arquivos respeitando os caminhos:

- `admin.html`, `admin.css`, `admin.js`: raiz, junto de `package.json`.
- `cloud/api.mjs`, `cloud/store.mjs`: pasta `cloud` existente.
- `lib/booking-status.mjs`: pasta `lib` existente (arquivo novo).
- O SQL e este guia podem ficar no repositório para referência.

Substitua as versões desses arquivos; preserve os outros arquivos e as variáveis já configuradas na Netlify. Faça **Commit changes** na branch publicada. Aguarde o novo deploy chegar a **Published**. As credenciais não precisam ser alteradas. A implantação é feita por você; o pacote não dispara publicação sozinho.

## 3. Testar

1. Abra `/admin` e entre.
2. Em um pedido de teste, clique **Ver pedido**.
3. Selecione **Em contato** ou **Confirmado** e clique **Salvar situação**.
4. Aguarde a mensagem de situação salva.
5. Feche o detalhe e recarregue o painel. Confira o selo, o filtro e o contador correspondente.

Se duas pessoas abrirem o mesmo pedido, quem salvar uma versão antiga recebe um aviso e a situação mais recente é carregada. A alteração de outra pessoa não é sobrescrita silenciosamente. Se a conexão falhar, o painel não informa sucesso; atualize o pedido para conferir o estado real.

A implementação foi testada localmente com PostgreSQL e no navegador. A migração e o deploy ainda precisam ser aplicados na sua conta para alterar o site que está no ar. O teste não enviou mensagens ou alterou registros reais na conta Supabase.
