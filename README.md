# LearnWords

## Мониторинг

Сервер мониторится [Beszel](https://beszel.dev): хаб (веб-панель) и агент работают на этом же сервере
(сервисы `beszel` и `beszel-agent` в `docker-compose.yml`, версия закреплена). Панель — https://monitor.yodla.fun.

### Первый запуск

1. **DNS.** Добавьте A-запись `monitor.yodla.fun` → IP сервера (как у `yodla.fun`). Сертификат Caddy получит сам.
2. **Пароль для входа на панель** (basic auth в Caddy, поверх логина Beszel):
   ```sh
   docker compose exec caddy caddy hash-password --plaintext 'ваш-пароль'
   ```
   В `.env` на сервере:
   ```sh
   BESZEL_BASIC_USER=admin
   BESZEL_BASIC_HASH='$2a$14$...'   # одинарные кавычки обязательны — в хеше есть "$"
   ```
   Пока этих переменных нет, панель закрыта (Caddy подставляет хеш случайного неизвестного пароля).
3. Запустите: `docker compose up -d beszel caddy`.
4. **Первый вход:** откройте https://monitor.yodla.fun, введите логин/пароль basic auth, затем создайте администратора Beszel.
5. **Агент.** В панели нажмите «Add system»:
   - Name — любое (например, `yodla`), **Host / IP** — `/beszel_socket/beszel.sock`;
   - скопируйте из окна **KEY** и **TOKEN** в `.env`:
     ```sh
     BESZEL_KEY='ssh-ed25519 AAAA...'
     BESZEL_TOKEN=...
     ```
   - `docker compose up -d beszel-agent`, затем «Add system» в панели. Через минуту появятся метрики.

   Пока `BESZEL_KEY` не задан, агент не может стартовать и перезапускается — это нормально до шага 5.

### Порт 8090 закрыт снаружи

Хаб слушает только `127.0.0.1:8090` (к нему ходят агент и Caddy). Проверка с **другого** компьютера:
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
