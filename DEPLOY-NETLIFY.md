# Publicar o site com backend na Netlify + Supabase

Este é o pacote **adaptado**. O pacote anterior era para servidor Node/SQLite ou demonstração. Para backend, a Netlify precisa executar o build e publicar as Functions: use **GitHub conectado à Netlify**, não o upload estático por arrastar arquivos.

Na primeira instalação, crie o projeto Supabase e configure os valores secretos. O pacote não cria contas nem publica automaticamente. Para atualizar um site já publicado com agenda e reagendamento, siga [ATUALIZAR-AGENDA.md](ATUALIZAR-AGENDA.md).

## 1. Criar o Supabase e as tabelas

1. Acesse [Supabase](https://supabase.com/dashboard) e crie um projeto.
2. No **SQL Editor**, execute o conteúdo completo de [supabase/schema.sql](supabase/schema.sql). O script cria tabelas, regras de acesso e funções transacionais. Pode ser reaplicado sem apagar pedidos.
3. No diálogo **Connect** ou nas configurações de API, localize a **Project URL** e uma **Secret key** (`sb_secret_…`). A chave fica apenas no backend. Também há suporte à chave legada `service_role`; não use `anon` ou `sb_publishable_…` aqui.
4. Não desative RLS nem crie acesso público às tabelas: somente as Functions usam a chave secreta. O navegador conversa com a API da Netlify, não com o Supabase diretamente.

## 2. Enviar o projeto ao GitHub

Extraia `thais-alam-netlify.zip` e coloque **os arquivos da raiz do pacote** no repositório, incluindo `netlify.toml`, `package.json`, `package-lock.json`, `netlify/`, `cloud/`, `lib/`, `scripts/` e `supabase/`. Preserve pastas e nomes.

Não envie `.env`, banco SQLite, credenciais, `node_modules`, `.netlify` ou arquivos de autenticação. A chave secreta nunca deve ser colocada em HTML, JavaScript do navegador, GitHub ou chat. Há `.env.example` somente com nomes e campos vazios.

## 3. Conectar a Netlify ao repositório

Na Netlify, use a opção de importar um projeto existente pelo Git e selecione o repositório. O `netlify.toml` já define:

| Campo | Valor |
| --- | --- |
| Build command | `npm run build:netlify` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |
| Node no build | `24` |

Não use `dist` como pasta pública: esse diretório pertence ao modo de servidor local. `public` contém apenas os arquivos do frontend permitidos.

## 4. Configurar os valores nas Functions

Nas variáveis de ambiente da Netlify, configure com escopo que inclua **Functions** e o contexto de deploy desejado:

| Nome | O que informar |
| --- | --- |
| `SUPABASE_URL` | Project URL, no formato `https://SEU-PROJETO.supabase.co` |
| `SUPABASE_SECRET_KEY` | Secret key do Supabase, marcada como valor secreto |
| `ADMIN_PASSWORD` | Senha escolhida por você, de 12 a 256 caracteres, marcada como secreta |
| `WHATSAPP_ENABLED` | `false`, enquanto a integração não for contratada/configurada |

`SUPABASE_SERVICE_ROLE_KEY` é uma alternativa legada a `SUPABASE_SECRET_KEY`, não uma exigência adicional.

`PUBLIC_ORIGIN` é opcional. Quando usar domínio próprio, configure o endereço HTTPS completo sem caminho. Sem ele, a função usa o endereço do deploy fornecido pela Netlify ou a origem da requisição. Se definir um domínio fixo, requisições de outras origens, inclusive previews em outro domínio, serão recusadas por proteção de origem.

O código das Functions funciona com Node 22+ e não carrega `node:sqlite`. Os testes e o modo SQLite local requerem Node 24. Para escolher explicitamente Node 24 no runtime das Functions, a Netlify permite configurar `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` na interface/API/CLI da plataforma; essa variável não deve ser colocada no `netlify.toml`.

Depois de salvar as variáveis, faça um novo deploy para que as funções recebam os valores.

## 5. Testar o pedido real

No domínio gerado para seu site:

1. Abra `/api/health`. Deve retornar `status: "ok"` e `backend: "netlify-supabase"` e `schemaVersion: 3`. Um resultado 503 significa que banco/configuração/acesso ainda não estão prontos; não é sucesso de instalação.
2. Abra `/#agendamento`. Preencha um pedido de teste, usando dados fictícios enquanto o WhatsApp está desligado.
3. Anote o protocolo `TA-…`.
4. Abra `/admin`, entre com a senha da equipe e abra **Pedidos do site** para pesquisar o protocolo. Na aba **Agenda do dia**, escolha a data do atendimento para ver os clientes em cada horário. O pedido deve aparecer com nome, contato, data, horário e observações.
5. Recarregue o painel para conferir a persistência. As sessões e os limites de tentativas ficam no Supabase e não dependem de memória de uma Function.
6. Saia do painel. A sessão deve perder acesso aos pedidos.

O backend salva pedidos pendentes. Não há confirmação automática de atendimento. Se a configuração estiver incompleta ou a gravação falhar, o site apresenta erro; não inventa um protocolo de sucesso.

## 6. WhatsApp depois da contratação

Por decisão do solicitante, **o envio fica desligado agora**. As credenciais e o template serão adicionados depois.

Quando estiver aprovado, configure nas Functions: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE=pt_BR`, `WHATSAPP_GRAPH_VERSION` e então `WHATSAPP_ENABLED=true`. Use um template aprovado com quatro parâmetros numéricos no corpo: nome, protocolo, data e horário, nessa ordem. O texto sugerido está no README.

Uma Scheduled Function executa a fila no deploy de produção a cada minuto, até um aviso por execução. Não usa `setInterval` nem exige que um processo continue rodando. Confira a execução no painel de Functions da Netlify; verifique os limites do plano escolhido antes de ativar em produção. Deploy previews não devem ser usados para validar o cron de produção.

A reivindicação do aviso é atômica no Postgres. Uma falha ou reinício ambíguo fica como envio incerto e não gera repetição automática; avisos antigos expiram. Ativar a configuração não dispara mensagens retroativas para pedidos registrados como não configurados. Aceito pela Meta é distinto de entregue no celular: webhooks de confirmação de entrega não estão implementados.

## Limites e preservação de dados

- Os dados ficam no Supabase; não são mantidos em arquivos temporários das Functions.
- O SQL usa tabelas com prefixo `salon_` e não remove tabelas de outros projetos.
- Pedidos SQLite antigos não são migrados automaticamente. O arquivo local é preservado; caso existam pedidos reais nele, faça uma migração separada antes de mudar o fluxo em produção.
- O painel tem **Agenda do dia** e **Pedidos do site**. Permite bloquear/liberar vagas, alterar situações e reagendar data e horário após contato manual pelo WhatsApp. A agenda é única para o salão; somente um atendimento confirmado/concluído ocupa cada janela. Pedidos pendentes não reservam vagas. O histórico conserva os reagendamentos; nenhuma dessas ações envia mensagens automaticamente.
- Considere região, retenção e backups conforme o projeto/planos escolhidos. As alterações são validadas localmente antes de o responsável aplicar na conta e conferir o deploy.

## Validação executada antes do pacote

Há testes com PostgreSQL embarcado real (PGlite): execução do SQL, reaplicação sem perda, regras de acesso, idempotência, sessão entre instâncias, logout, limite de tentativas e fila de WhatsApp com chamadas simuladas. Os bundles das Functions também são montados e executados localmente. Isso não substitui o teste final no domínio publicado com o Supabase da sua conta.

Referências: [Netlify Functions](https://docs.netlify.com/build/functions/overview/), [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/), [configuração de Functions](https://docs.netlify.com/build/functions/optional-configuration/), [chaves Supabase](https://supabase.com/docs/guides/api/api-keys).
