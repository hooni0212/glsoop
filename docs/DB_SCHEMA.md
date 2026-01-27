# 글숲 DB Schema (SQLite)

> DB 파일: `data/live/users.db`
>
> `db.js`에서 테이블 생성 + 일부 컬럼은 **없으면 ALTER TABLE로 자동 추가**되는 형태로 관리한다.

---

## 1) users

기본 컬럼
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `name` TEXT NOT NULL
- `nickname` TEXT
- `bio` TEXT
- `about` TEXT
- `email` TEXT NOT NULL UNIQUE
- `pw` TEXT NOT NULL
- `is_admin` INTEGER DEFAULT 0
- `is_verified` INTEGER DEFAULT 0
- `verification_token` TEXT
- `verification_expires` DATETIME
- `reset_token` TEXT
- `reset_expires` DATETIME

확장 컬럼 (없으면 자동 추가)
- `level` INTEGER DEFAULT 1
- `xp` INTEGER DEFAULT 0
- `streak_days` INTEGER DEFAULT 0
- `max_streak_days` INTEGER DEFAULT 0
- `last_post_date` TEXT

---

## 2) otp_verifications

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id` INTEGER NOT NULL (FK → users.id, ON DELETE CASCADE)
- `code_hash` TEXT NOT NULL
- `expires_at` DATETIME NOT NULL
- `attempts` INTEGER DEFAULT 0
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

---

## 3) posts

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id` INTEGER NOT NULL (FK → users.id)
- `title` TEXT NOT NULL
- `content` TEXT NOT NULL
- `category` TEXT DEFAULT 'short'
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

---

## 4) likes

- `user_id` INTEGER NOT NULL (FK → users.id)
- `post_id` INTEGER NOT NULL (FK → posts.id)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- PRIMARY KEY (`user_id`, `post_id`)

---

## 5) follows

- `follower_id` INTEGER NOT NULL (FK → users.id)
- `followee_id` INTEGER NOT NULL (FK → users.id)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- PRIMARY KEY (`follower_id`, `followee_id`)

---

## 6) hashtags

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `name` TEXT NOT NULL UNIQUE

---

## 7) post_hashtags

- `post_id` INTEGER NOT NULL (FK → posts.id, ON DELETE CASCADE)
- `hashtag_id` INTEGER NOT NULL (FK → hashtags.id, ON DELETE CASCADE)
- UNIQUE (`post_id`, `hashtag_id`)

---

## 8) bookmark_lists

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id` INTEGER NOT NULL (FK → users.id)
- `name` TEXT NOT NULL
- `description` TEXT
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- UNIQUE (`user_id`, `name`)

---

## 9) bookmark_items

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `list_id` INTEGER NOT NULL (FK → bookmark_lists.id, ON DELETE CASCADE)
- `post_id` INTEGER NOT NULL (FK → posts.id, ON DELETE CASCADE)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- UNIQUE (`list_id`, `post_id`)

---

## 10) xp_log

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id` INTEGER NOT NULL (FK → users.id)
- `delta` INTEGER NOT NULL
- `reason` TEXT NOT NULL
- `meta` TEXT
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

---

## 11) quest_templates

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `name` TEXT NOT NULL
- `description` TEXT
- `condition_type` TEXT NOT NULL
- `category` TEXT
- `target_value` INTEGER NOT NULL
- `reward_xp` INTEGER DEFAULT 0
- `is_active` INTEGER DEFAULT 1
- `template_kind` TEXT NOT NULL DEFAULT 'quest'
- `code` TEXT
- `ui_json` TEXT
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

---

## 12) quest_campaigns

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `name` TEXT NOT NULL
- `description` TEXT
- `campaign_type` TEXT DEFAULT 'event'
- `start_at` DATETIME
- `end_at` DATETIME
- `is_active` INTEGER DEFAULT 0
- `priority` INTEGER DEFAULT 1
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP

---

## 13) quest_campaign_items

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `campaign_id` INTEGER NOT NULL (FK → quest_campaigns.id, ON DELETE CASCADE)
- `template_id` INTEGER NOT NULL (FK → quest_templates.id, ON DELETE CASCADE)
- `sort_order` INTEGER DEFAULT 0

---

## 14) user_quest_state

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id` INTEGER NOT NULL (FK → users.id)
- `campaign_id` INTEGER NOT NULL (FK → quest_campaigns.id)
- `template_id` INTEGER NOT NULL (FK → quest_templates.id)
- `progress` INTEGER DEFAULT 0
- `reset_key` TEXT
- `completed_at` DATETIME
- `reward_claimed_at` DATETIME
- UNIQUE (`user_id`, `campaign_id`, `template_id`, `reset_key`)
