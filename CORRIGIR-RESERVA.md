# Reservar a vaga assim que receber o primeiro pedido

Esta correção muda a regra da agenda: **Aguardando contato** e **Em contato** já seguram o horário, mesmo antes de o salão confirmar o atendimento. Uma segunda solicitação para a mesma data e hora é recusada pelo servidor, inclusive quando duas pessoas enviam ao mesmo tempo ou uma delas está com o formulário antigo aberto.

## 1. Atualizar o Supabase

No **Supabase → SQL Editor**, substitua o texto da consulta pelo conteúdo completo de **supabase/migrations/004-reservar-pedido-pendente.sql** e clique em **Run**. Aguarde Success.

Este script é para quem já executou a migração 003 da agenda. Pode reaplicar a 004: preserva os registros, protocolos, situações e histórico. Em uma instalação nova, `supabase/schema.sql` já contém a regra nova. Se estiver atualizando uma instalação anterior à agenda, execute primeiro 003 e depois 004.

## 2. Atualizar o GitHub e a Netlify

Extraia **correcao-reserva-horarios.zip** com **Extrair tudo**. No repositório que a Netlify já publica, use **Add file → Upload files** e arraste os arquivos e as pastas inteiras, respeitando os caminhos. Os arquivos da raiz ficam junto do `package.json`; `api.mjs` precisa ficar dentro de `cloud`, e `agenda.mjs` e `agenda-sqlite.mjs` dentro de `lib`.

O pacote atualiza a interface, as regras do servidor, o SQL, os testes e a demonstração. Substitua as versões desses caminhos, faça **Commit changes** na branch `main` e espere o deploy ficar **Published**. A configuração e as chaves já cadastradas na Netlify continuam sendo usadas.

## 3. Regra dos horários

- **Aguardando contato / Em contato:** vaga reservada enquanto a equipe avalia e conversa com o cliente. O atendimento ainda precisa de confirmação.
- **Confirmado:** atendimento confirmado, vaga ocupada.
- **Concluído:** conserva a ocupação registrada.
- **Reagendar / Cancelado:** deixa de reservar o horário anterior. O pedido continua no histórico.
- **Horário bloqueado pela equipe:** indisponível no formulário, independentemente das solicitações.

Salvar um reagendamento como Em contato ou Confirmado reserva a nova vaga e libera a anterior. Reagendar não envia WhatsApp automaticamente. Para indisponibilizar um horário com pedido ativo, primeiro resolva o pedido com o cliente, depois bloqueie a vaga no painel.

As reservas pendentes não expiram automaticamente. A equipe deve cancelar ou marcar Reagendar quando a vaga não será usada.

## 4. Resolver os duplicados do teste anterior

Os dois pedidos que já aparecem no mesmo horário **serão preservados**. A correção não escolhe nem cancela clientes por conta própria. Na agenda, um aviso identifica os pedidos antigos para a mesma vaga.

Confira os protocolos, abra o pedido de teste duplicado e salve como **Cancelado** (ou reagende um deles para outro horário). O pedido restante mantém a vaga reservada. Para deixar a vaga totalmente livre, cancele/reagende todos os pedidos ativos daquele horário. O teste antigo continua aparecendo com a situação correta; ele não é apagado.

## 5. Conferir a correção publicada

1. Abra `/api/health`: deve mostrar `status: "ok"`, `backend: "netlify-supabase"` e `schemaVersion: 4`.
2. Em duas janelas do navegador, selecione a mesma data e hora futura, usando dados fictícios enquanto o WhatsApp automático estiver desligado.
3. Envie na primeira janela. Ela deve receber um protocolo.
4. Tente enviar na segunda: deve avisar que a vaga ficou indisponível e carregar os horários novamente. Nenhum segundo pedido deve ser salvo.
5. Em `/admin`, a primeira solicitação deve aparecer como **Reservado · aguardando confirmação**, com situação Aguardando contato.
6. Marque Em contato: a vaga continua reservada. Cancele ou reagende o pedido: a vaga anterior volta ao formulário, desde que não tenha outro pedido ativo ou bloqueio manual.

A correção foi validada localmente com SQL PostgreSQL, SQLite e navegador. Não foram acessadas credenciais de produção, alterados pedidos reais ou enviadas mensagens.
