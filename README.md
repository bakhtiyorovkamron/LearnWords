# LearnWords

## Мониторинг

Сервер мониторится [Beszel](https://beszel.dev): хаб (веб-панель) и агент работают на этом же сервере
(сервисы `beszel` и `beszel-agent` в `docker-compose.yml`, версия закреплена). Панель не опубликована
в интернете — хаб слушает только `127.0.0.1:8090` на сервере, вход только через SSH-туннель.

### Вход в панель

```sh
ssh -L 8090:localhost:8090 user@IP_СЕРВЕРА
```
Пока SSH-сессия открыта, откройте в браузере http://localhost:8090.

### Первый запуск

1. На сервере: `docker compose up -d beszel`.
2. Откройте панель через туннель и создайте администратора Beszel.
3. **Агент.** В панели нажмите «Add system»:
   - Name — любое (например, `yodla`), **Host / IP** — `/beszel_socket/beszel.sock`;
   - скопируйте из окна **KEY** и **TOKEN** в `.env` на сервере:
     ```sh
     BESZEL_KEY='ssh-ed25519 AAAA...'
     BESZEL_TOKEN=...
     ```
   - `docker compose up -d beszel-agent`, затем «Add system» в панели. Через минуту появятся метрики.

   Пока `BESZEL_KEY` не задан, агент не может стартовать и перезапускается — это нормально до шага 3.

### Порт 8090 закрыт снаружи

Проверка с **другого** компьютера (без туннеля):
```sh
curl -m 5 http://IP_СЕРВЕРА:8090   # должно быть: Connection refused / timeout
```
На сервере: `ss -ltnp | grep 8090` — адрес должен быть `127.0.0.1:8090`, не `0.0.0.0:8090`.

### Уведомления в Telegram

Настраиваются в панели: Settings → Notifications, по инструкции
https://beszel.dev/guide/notifications/telegram (бот через @BotFather, URL вида `telegram://<token>@telegram?chats=<chat_id>`),
затем кнопка «Test».

### Алерты

На карточке системы — значок колокольчика (Alerts). Включите:

| Алерт | Порог |
|---|---|
| Status (система не отвечает) | вкл. |
| CPU Usage | > 80 %, длительность 10 минут |
| Memory Usage | > 85 % |
| Disk Usage | > 80 % |
