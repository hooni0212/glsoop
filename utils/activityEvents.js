const { buildPublicDisplayName } = require('./accountLifecycle');
const { getAsync, allAsync, runAsync } = require('./questService');

const ACTIVITY_TYPES = Object.freeze({
  POST_LIKED: 'post_liked',
  POST_BOOKMARKED: 'post_bookmarked',
  COMMENT_CREATED: 'comment_created',
  COMMENT_REPLIED: 'comment_replied',
  SYSTEM: 'system',
});

const PUSH_ENABLED_ACTIVITY_TYPES = new Set([
  ACTIVITY_TYPES.POST_LIKED,
  ACTIVITY_TYPES.POST_BOOKMARKED,
  ACTIVITY_TYPES.COMMENT_CREATED,
  ACTIVITY_TYPES.COMMENT_REPLIED,
]);

function toPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeActivityType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.values(ACTIVITY_TYPES).includes(normalized) ? normalized : null;
}

function normalizeNullableText(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function serializeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  try {
    return JSON.stringify(meta);
  } catch (error) {
    return null;
  }
}

function parseMeta(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function buildActivityCopy({ eventType, actorDisplayName, postTitle }) {
  const actor = actorDisplayName || '누군가';
  if (eventType === ACTIVITY_TYPES.POST_LIKED) {
    return {
      title: '새 공감',
      body: `${actor}님이 회원님의 글을 공감했어요.`,
    };
  }
  if (eventType === ACTIVITY_TYPES.POST_BOOKMARKED) {
    return {
      title: '새 북마크',
      body: `${actor}님이 회원님의 글을 저장했어요.`,
    };
  }
  if (eventType === ACTIVITY_TYPES.COMMENT_REPLIED) {
    return {
      title: '새 답글',
      body: `${actor}님이 회원님의 댓글에 답글을 남겼어요.`,
    };
  }
  if (eventType === ACTIVITY_TYPES.COMMENT_CREATED) {
    return {
      title: '새 댓글',
      body: `${actor}님이 "${postTitle || '회원님의 글'}"에 댓글을 남겼어요.`,
    };
  }
  return {
    title: '글숲 알림',
    body: '새로운 활동이 있습니다.',
  };
}

async function fetchActorSummary(actorUserId) {
  const userId = toPositiveInt(actorUserId);
  if (!userId) return null;
  return getAsync(
    `
    SELECT id, nickname, COALESCE(account_status, 'active') AS account_status
    FROM users
    WHERE id = ?
    LIMIT 1
    `,
    [userId]
  );
}

async function enqueuePushDeliveries(activity) {
  if (!activity?.id || !PUSH_ENABLED_ACTIVITY_TYPES.has(activity.event_type)) {
    return { queued: 0 };
  }

  const tokens = await allAsync(
    `
    SELECT id
    FROM push_tokens
    WHERE user_id = ?
      AND enabled = 1
    ORDER BY last_seen_at DESC, id DESC
    `,
    [activity.recipient_user_id]
  );

  if (!tokens.length) return { queued: 0 };

  let queued = 0;
  for (const token of tokens) {
    await runAsync(
      `
      INSERT INTO push_delivery_queue (
        activity_event_id,
        recipient_user_id,
        push_token_id,
        title,
        body,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        activity.id,
        activity.recipient_user_id,
        token.id,
        activity.title || '글숲 알림',
        activity.body || '새로운 활동이 있습니다.',
        serializeMeta({
          activity_event_id: activity.id,
          event_type: activity.event_type,
          post_id: activity.post_id || null,
          comment_id: activity.comment_id || null,
        }),
      ]
    );
    queued += 1;
  }

  return { queued };
}

async function createActivityEvent(input = {}) {
  const recipientUserId = toPositiveInt(input.recipientUserId);
  const actorUserId = toPositiveInt(input.actorUserId);
  const eventType = normalizeActivityType(input.eventType);

  if (!recipientUserId || !eventType) return null;
  if (actorUserId && actorUserId === recipientUserId && eventType !== ACTIVITY_TYPES.SYSTEM) {
    return null;
  }

  const postId = toPositiveInt(input.postId);
  const commentId = toPositiveInt(input.commentId);
  const parentCommentId = toPositiveInt(input.parentCommentId);
  const actor = await fetchActorSummary(actorUserId);
  const actorDisplayName = actor
    ? buildPublicDisplayName(actor.nickname, actor.account_status)
    : null;
  const copy = buildActivityCopy({
    eventType,
    actorDisplayName,
    postTitle: normalizeNullableText(input.postTitle, 80),
  });

  const title = normalizeNullableText(input.title, 120) || copy.title;
  const body = normalizeNullableText(input.body, 240) || copy.body;
  const metaJson = serializeMeta({
    ...(input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
      ? input.meta
      : {}),
    actor_display_name: actorDisplayName,
  });
  const uniqueKey = normalizeNullableText(input.uniqueKey, 200);

  const result = await runAsync(
    `
    INSERT OR IGNORE INTO activity_events (
      recipient_user_id,
      actor_user_id,
      event_type,
      post_id,
      comment_id,
      parent_comment_id,
      title,
      body,
      meta_json,
      unique_key
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      recipientUserId,
      actorUserId,
      eventType,
      postId,
      commentId,
      parentCommentId,
      title,
      body,
      metaJson,
      uniqueKey,
    ]
  );

  if (result.changes <= 0 && uniqueKey) {
    return getAsync('SELECT * FROM activity_events WHERE unique_key = ? LIMIT 1', [uniqueKey]);
  }

  const activity = await getAsync('SELECT * FROM activity_events WHERE id = ? LIMIT 1', [
    result.lastID,
  ]);
  await enqueuePushDeliveries(activity);
  return activity;
}

function mapActivityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipient_user_id: row.recipient_user_id,
    actor_user_id: row.actor_user_id,
    actor: row.actor_user_id
      ? {
          id: row.actor_user_id,
          nickname: row.actor_nickname || null,
          display_name: buildPublicDisplayName(row.actor_nickname, row.actor_account_status),
        }
      : null,
    event_type: row.event_type,
    post_id: row.post_id,
    post_title: row.post_title || null,
    comment_id: row.comment_id,
    parent_comment_id: row.parent_comment_id,
    title: row.title,
    body: row.body,
    meta: parseMeta(row.meta_json),
    read_at: row.read_at || null,
    created_at: row.created_at,
  };
}

module.exports = {
  ACTIVITY_TYPES,
  createActivityEvent,
  mapActivityRow,
  toPositiveInt,
};
