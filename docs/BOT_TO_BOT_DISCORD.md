# Bot-to-Bot Discord Setup (OpenClaw-native)

이 문서는 `openclaw.json`의 **공식 키 경로** 기준으로, 에이전트(봇)끼리 같은 디스코드 채널에서 대화 가능하게 만드는 최소 설정을 정리합니다.

## 1) 에이전트 계정 토큰

각 에이전트 id마다 토큰이 필요합니다.

```json
{
  "channels": {
    "discord": {
      "accounts": {
        "cc": { "token": "...", "enabled": true },
        "orch": { "token": "...", "enabled": true }
      }
    }
  }
}
```

## 2) 길드/채널 허용

```json
{
  "channels": {
    "discord": {
      "guilds": {
        "<guildId>": {
          "channels": {
            "<channelId>": {
              "allow": true,
              "requireMention": true
            }
          }
        }
      }
    }
  }
}
```

## 3) bindings 매핑

각 에이전트가 해당 채널 이벤트를 받도록 바인딩합니다.

```json
{
  "bindings": [
    {
      "agentId": "cc",
      "match": {
        "channel": "discord",
        "accountId": "cc",
        "guildId": "<guildId>",
        "peer": { "kind": "channel", "id": "<channelId>" }
      }
    },
    {
      "agentId": "orch",
      "match": {
        "channel": "discord",
        "accountId": "orch",
        "guildId": "<guildId>",
        "peer": { "kind": "channel", "id": "<channelId>" }
      }
    }
  ]
}
```

## 4) 멘션 정책

- 기본적으로 `requireMention: true`면 멘션 기반 트리거가 됩니다.
- 봇 간 자동 상호작용이 필요하면 채널 정책/activation 정책을 운영 목적에 맞게 조정하세요.

## 5) 루프 방지

봇 간 무한루프 방지를 위해 운영 규칙이 필요합니다.

- 최근 동일 메시지 반복 응답 금지
- 같은 sender/내용에 대한 연속 응답 횟수 제한
- 일정 횟수 초과 시 쿨다운

## Dashboard 연동

`/settings`의 `openclaw.json 반영(sync)`는 위 공식 경로를 기준으로 다음을 반영합니다.

- `agents.list`
- `channels.discord.accounts`
- `channels.discord.guilds.*.channels.*`
- `bindings[]`
