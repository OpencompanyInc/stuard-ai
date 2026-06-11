import { describe, expect, it } from 'vitest';
import {
  classifyXTweets,
  isXReplyToUser,
  isXUserPost,
  isXMentionOfUser,
  normalizeXPostId,
  matchesXPostFilter,
  xCommentMatchesTriggerArgs,
} from './social-triggers';

const USER_ID = '111';

describe('X tweet classification for social triggers', () => {
  it('treats a reply to the subscribed user as a new comment', () => {
    const tweet = {
      id_str: 'reply-1',
      text: 'NICE, I like that car.',
      in_reply_to_user_id_str: USER_ID,
      in_reply_to_status_id_str: 'post-root',
      user: { id_str: '222', username: 'Jacob_Rhodes_' },
    };
    expect(isXReplyToUser(tweet, USER_ID)).toBe(true);
    expect(isXUserPost(tweet, USER_ID)).toBe(false);
    expect(isXMentionOfUser(tweet, USER_ID)).toBe(false);
  });

  it('treats the subscribed user publishing a post as user_post', () => {
    const tweet = {
      id_str: 'post-1',
      text: 'Do you have a dream car?',
      user: { id_str: USER_ID, username: 'Ifesoll' },
    };
    expect(isXUserPost(tweet, USER_ID)).toBe(true);
    expect(isXReplyToUser(tweet, USER_ID)).toBe(false);
  });

  it('does not treat the subscribed user replying to someone else as a new comment', () => {
    const tweet = {
      id_str: 'self-reply',
      text: 'Thanks!',
      in_reply_to_user_id_str: '222',
      in_reply_to_status_id_str: 'reply-1',
      user: { id_str: USER_ID },
    };
    expect(isXReplyToUser(tweet, USER_ID)).toBe(false);
    expect(isXUserPost(tweet, USER_ID)).toBe(false);
  });

  it('treats @mentions without a reply parent as mentions, not comments', () => {
    const tweet = {
      id_str: 'mention-1',
      text: '@Ifesoll check this out',
      in_reply_to_user_id_str: USER_ID,
      user: { id_str: '222' },
      entities: {
        user_mentions: [{ id_str: USER_ID, username: 'Ifesoll' }],
      },
    };
    expect(isXMentionOfUser(tweet, USER_ID)).toBe(true);
    expect(isXReplyToUser(tweet, USER_ID)).toBe(false);
  });

  it('classifies mixed tweet_create_events into separate buckets', () => {
    const tweets = [
      {
        id_str: 'post-root',
        text: 'Dream car?',
        user: { id_str: USER_ID },
      },
      {
        id_str: 'reply-1',
        text: 'McLaren 750S',
        in_reply_to_user_id_str: USER_ID,
        in_reply_to_status_id_str: 'post-root',
        user: { id_str: '222' },
      },
      {
        id_str: 'mention-1',
        text: '@Ifesoll hello',
        user: { id_str: '333' },
        entities: { user_mentions: [{ id_str: USER_ID }] },
      },
    ];

    const { userPosts, comments, mentions } = classifyXTweets(tweets, USER_ID);
    expect(userPosts.map((t) => t.id_str)).toEqual(['post-root']);
    expect(comments.map((t) => t.id_str)).toEqual(['reply-1']);
    expect(mentions.map((t) => t.id_str)).toEqual(['mention-1']);
  });

  it('ignores retweets when classifying', () => {
    const tweet = {
      id_str: 'rt-1',
      user: { id_str: '222' },
      retweeted_status: { id_str: 'post-1' },
    };
    const { userPosts, comments, mentions } = classifyXTweets([tweet], USER_ID);
    expect(userPosts).toEqual([]);
    expect(comments).toEqual([]);
    expect(mentions).toEqual([]);
  });
});

describe('x.new_comment trigger filters', () => {
  const POST_ID = '2065123456789';
  const replyOnPost = {
    id_str: 'reply-1',
    text: 'NICE, I like that car. Mine is the McLaren 750S',
    in_reply_to_user_id_str: '111',
    in_reply_to_status_id_str: POST_ID,
    conversation_id: POST_ID,
    user: { id_str: '222', screen_name: 'Jacob_Rhodes_', username: 'Jacob_Rhodes_' },
  };

  it('normalizes post ids from status URLs', () => {
    expect(normalizeXPostId('https://x.com/Ifesoll/status/2065123456789')).toBe('2065123456789');
    expect(normalizeXPostId('2065123456789')).toBe('2065123456789');
    expect(normalizeXPostId('')).toBeUndefined();
  });

  it('filters by post id for direct and thread replies', () => {
    expect(matchesXPostFilter(replyOnPost, POST_ID, true)).toBe(true);
    expect(matchesXPostFilter(replyOnPost, POST_ID, false)).toBe(true);
    expect(matchesXPostFilter(replyOnPost, 'other-post', true)).toBe(false);

    const nestedReply = {
      ...replyOnPost,
      in_reply_to_status_id_str: 'reply-1',
      conversation_id: POST_ID,
    };
    expect(matchesXPostFilter(nestedReply, POST_ID, true)).toBe(false);
    expect(matchesXPostFilter(nestedReply, POST_ID, false)).toBe(true);
  });

  it('applies combined smart args before dispatch', () => {
    expect(xCommentMatchesTriggerArgs(replyOnPost, {
      post_id: 'https://x.com/user/status/2065123456789',
      from_username: '@Jacob_Rhodes_',
      contains_text: 'McLaren',
    })).toBe(true);

    expect(xCommentMatchesTriggerArgs(replyOnPost, {
      post_id: POST_ID,
      from_username: 'someone_else',
    })).toBe(false);

    expect(xCommentMatchesTriggerArgs(replyOnPost, {
      post_id: POST_ID,
      contains_text: 'Ferrari',
    })).toBe(false);

    expect(xCommentMatchesTriggerArgs(replyOnPost, {})).toBe(true);
  });
});
