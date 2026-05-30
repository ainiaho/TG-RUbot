/**
 * Open Wegram Bot - Core Logic
 * Shared code between Cloudflare Worker and Vercel deployments
 */
import {
  banTopic,
  checkInit,
  doCheckInit,
  fixPinMessage,
  init,
  motherBotCommands,
  parseMetaDataMessage,
  processERReceived,
  processERSent,
  processPMDeleteReceived,
  processPMDeleteSent,
  processPMEditReceived,
  processPMEditSent,
  processPMReceived,
  processPMSent,
  processTopicCommentNameEdit,
  reset,
  unbanTopic
} from './topicPmHandler.js'

export const allowed_updates = ['message', 'message_reaction', 'edited_message'];

export function validateSecretToken(token) {
  return token.length > 15 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function postToTelegramApi(token, method, body) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function handleInstall(request, ownerUid, botToken, prefix, secretToken) {
  if (!validateSecretToken(secretToken)) {
    return jsonResponse({
      success: false,
      message: 'Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.'
    }, 400);
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.hostname}`;
  const webhookUrl = `${baseUrl}/${prefix}/webhook/${ownerUid}/${botToken}`;

  try {
    const response = await postToTelegramApi(botToken, 'setWebhook', {
      url: webhookUrl,
      allowed_updates: allowed_updates,
      secret_token: secretToken
    });

    const result = await response.json();
    if (result.ok) {
      return jsonResponse({ success: true, message: 'Webhook successfully installed.' });
    }

    return jsonResponse({ success: false, message: `Failed to install webhook: ${result.description}` }, 400);
  } catch (error) {
    return jsonResponse({ success: false, message: `Error installing webhook: ${error.message}` }, 500);
  }
}

export async function handleUninstall(botToken, secretToken) {
  if (!validateSecretToken(secretToken)) {
    return jsonResponse({
      success: false,
      message: 'Secret token must be at least 16 characters and contain uppercase letters, lowercase letters, and numbers.'
    }, 400);
  }

  try {
    const response = await postToTelegramApi(botToken, 'deleteWebhook', {})

    const result = await response.json();
    if (result.ok) {
      return jsonResponse({ success: true, message: 'Webhook successfully uninstalled.' });
    }

    return jsonResponse({ success: false, message: `Failed to uninstall webhook: ${result.description}` }, 400);
  } catch (error) {
    return jsonResponse({ success: false, message: `Error uninstalling webhook: ${error.message}` }, 500);
  }
}

export async function handleWebhook(request, ownerUid, botToken, secretToken, childBotUrl, childBotSecretToken) {
  if (secretToken !== request.headers.get('X-Telegram-Bot-Api-Secret-Token')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const update = await request.json();
  // --- for debugging ---
  // TODO: 2025/5/10 don't forget to close
  // await postToTelegramApi(botToken, 'sendMessage', {
  //   chat_id: ownerUid,
  //   text: `DEBUG MESSAGE! update: ${JSON.stringify(update)}`,
  // });
  // --- for debugging ---

  if (update.edited_message) {
    try {
      const messageEdited = update.edited_message
      const fromChat = messageEdited.chat;
      const fromUser = messageEdited.from;

      const check = await doCheckInit(botToken, ownerUid)
      if (!check.failed) {
        const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
        const {
          superGroupChatId,
          topicToFromChat,
          fromChatToTopic,
          bannedTopics,
          topicToCommentName,
          fromChatToCommentName
        } = parseMetaDataMessage(metaDataMessage);
        if (false) {
          // ignore message types
          return new Response('OK');
        } else if (fromUser.id.toString() === ownerUid && fromChat.id === superGroupChatId
            && fromChat.is_forum) {
          // topic ER send to others.
          await processPMEditSent(botToken, messageEdited, superGroupChatId, topicToFromChat);
        } else {
          // topic ER receive from others.
          if (!bannedTopics.includes(fromChatToTopic.get(fromChat.id))) {
            await processPMEditReceived(botToken, ownerUid, messageEdited, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName)
          }
        }
        return new Response('OK');
      }
      return new Response('OK');
    } catch (error) {
      // --- for debugging ---
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: `Error! You can send the message to developer for getting help : ${error.message} Stack: ${error.stack} origin: ${JSON.stringify(update)}`,
      });
      // --- for debugging ---
      return new Response('OK');
    }
  }

  if (update.message_reaction) {
    try {
      // message_reaction EMOJI REACT(ER)
      const messageReaction = update.message_reaction
      const fromChat = messageReaction.chat;
      const fromUser = messageReaction.user;

      const check = await doCheckInit(botToken, ownerUid)
      if (!check.failed) {
        const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
        const {
          superGroupChatId,
          topicToFromChat,
          fromChatToTopic,
          bannedTopics,
          topicToCommentName,
          fromChatToCommentName
        } = parseMetaDataMessage(metaDataMessage);
        if (false) {
          // ignore message types
          return new Response('OK');
        } else if (fromUser.id.toString() === ownerUid && fromChat.id === superGroupChatId
            && fromChat.is_forum) {
          // topic ER send to others.
          await processERSent(botToken, messageReaction, topicToFromChat);
        } else {
          // topic ER receive from others.
          if (!bannedTopics.includes(fromChatToTopic.get(fromChat.id))) {
            await processERReceived(botToken, ownerUid, fromUser, messageReaction, superGroupChatId, bannedTopics);
          }
        }
        return new Response('OK');
      }
      return new Response('OK');
    } catch (error) {
      // --- for debugging ---
      await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: ownerUid,
        text: `Error! You can send the message to developer for getting help : ${error.message} Stack: ${error.stack} origin: ${JSON.stringify(update)}`,
      });
      // --- for debugging ---
      return new Response('OK');
    }
  }

  if (!update.message) {
    return new Response('OK');
  }
  const message = update.message;
  const fromChat = message.chat;
  const fromUser = message.from;

  if (childBotUrl) {
    // --- delivery children bots ---
    return await motherBotCommands(botToken, ownerUid, message, childBotUrl, childBotSecretToken);
  }

  // --- commands ---
  try {
    if (fromUser.id.toString() === ownerUid && fromChat.is_forum
        && message.text?.startsWith(".!") && message.text?.endsWith("!.")) {
      if (!message.is_topic_message) {
        // --- commands in General topic ---
        if (message.text === ".!pm_RUbot_checkInit!.") {
          return await checkInit(botToken, ownerUid, message);
        } else if (message.text === ".!pm_RUbot_doInit!.") {
          return await init(botToken, ownerUid, message);
        } else if (message.text === ".!pm_RUbot_doReset!.") {
          return await reset(botToken, ownerUid, message, false);
        }
      } else {
        // --- commands in PM topic ---
        const check = await doCheckInit(botToken, ownerUid)
        if (!check.failed) {
          const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
          const {
            superGroupChatId,
            topicToFromChat,
            fromChatToTopic,
            bannedTopics,
            topicToCommentName,
            fromChatToCommentName
          } = parseMetaDataMessage(metaDataMessage);
          if (fromChat.id !== superGroupChatId) {
            await postToTelegramApi(botToken, 'sendMessage', {
              chat_id: fromChat.id,
              text: `Only can work in your PM super group`,
            });
            return new Response('OK');
          }
          if (message.text === (".!pm_RUbot_ban!.")) {
            return await banTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, false);
          } else if (message.text === (".!pm_RUbot_unban!.")) {
            return await unbanTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, false);
          } else if (message.text === (".!pm_RUbot_silent_ban!.")) {
            return await banTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, true);
          } else if (message.text === (".!pm_RUbot_silent_unban!.")) {
            return await unbanTopic(botToken, ownerUid, message, topicToFromChat, metaDataMessage, true);
          }
        }
      }
      return new Response('OK');
    } else if (fromUser.id.toString() === ownerUid && fromChat.id.toString() === ownerUid
        && message.text?.startsWith(".!") && message.text?.endsWith("!.")) {
      // --- commands in Owner Chat ---
      if (message.text === ".!pm_RUbot_doReset!.") {
        return await reset(botToken, ownerUid, message, true);
      }
    }
  } catch (error) {
    // --- for debugging ---
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: `Error! You can send the message to developer for getting help : ${error.message} Stack: ${error.stack} origin: ${JSON.stringify(update)}`,
    });
    // --- for debugging ---
    return new Response('OK');
  }
  // --- commands ---

  try {
    if ("/start" === message.text) {
      // Introduction words for various scenarios
      let introduction = "*欢迎使用 Deepthink 双向机器人\\!*" +
          "\n>我是一个思考型对话机器人。" +
          "\n>我会将你的消息转发给我的主人，也会将主人的消息转发给你。" +
          "\n*以下是一些重要细节：*" +
          "\n**>emoji 反应：" +
          "\n>  消息下方的 🕊 emoji 反应表示消息成功转发。" +
          "\n>  如果没有看到，说明消息未被转发。" +
          "\n>  你可以给我的消息和主人的消息添加其他 emoji 反应（除了这条消息本身），我也会转发。" +
          "\n>  但由于机器人 API 限制，我每条消息只能发送一个免费 emoji 反应。" +
          "\n>  所以如果你是 TG 高级用户并对一条消息添加了多个 emoji，我只会转发最后一个免费 emoji。||" +
          "\n" +
          "\n**>编辑消息：" +
          "\n>  你可以像平常一样编辑消息，但目前仅限于文本消息。转发成功后，会出现 🦄 emoji 反应，随后约 1 秒内恢复为 🕊。" +
          "\n>  如果没有看到，说明编辑未被转发。" +
          "\n>  如果你没有看到这个反应，可以尝试用不同的内容再次编辑。||" +
          "\n" +
          "\n**>删除消息：" +
          "\n>  你可以通过回复我转发的原始消息并输入 `#del` 来删除消息。无需其他操作。" +
          "\n>  但我只能删除我自己的消息，无法删除你的消息。所以你需要自己删除消息，包括［原始消息］［命令消息］和［通知消息］。||" +
          "\n" +
          "\n*如果想再次看到此消息，*" +
          "\n*请发送 `/start` 命令给我。*";
      if (fromUser.id.toString() === ownerUid) {
        // for owner only
        introduction += "\n" +
            "\n*以下内容仅对机器人主人（你）可见且有效。*" +
            "\n" +
            "\n**>删除消息：" +
            "\n>  我可以在群组中删除你的消息和我的消息，因为我有必要的权限。" +
            "\n" +
            "\n*获取帮助*" +
            "\n此机器人完全*开源*且*免费*使用。如需帮助，请联系我的开发者。" +
            "\n";
        if (fromChat.is_forum && message.is_topic_message) {
          // commands in PM topic
          introduction +=
              "\n*其他位置的命令：*" +
              "\n在与机器人的私聊中：" +
              "\n`.!pm_RUbot_doReset!.`" +
              "\n在 PM 超级群的常规话题中：" +
              "\n`.!pm_RUbot_checkInit!.`" +
              "\n`.!pm_RUbot_doInit!.`" +
              "\n`.!pm_RUbot_doReset!.`" +
              "\n" +
              "\n*此处有效的命令：*" +
              "\n*禁止此话题*" +
              "\n➡️`.!pm_RUbot_ban!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n**>说明：" +
              "\n>禁止发送命令的话题，停止转发相应聊天的消息，并向对方发送已被禁止的通知。||" +
              "\n➡️`.!pm_RUbot_unban!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n**>说明：" +
              "\n>解除对发送命令话题的禁止，并向对方发送已被解除禁止的通知。||" +
              "\n➡️`.!pm_RUbot_silent_ban!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n**>说明：" +
              "\n>禁止发送命令的话题，停止转发相应聊天的消息。||" +
              "\n➡️`.!pm_RUbot_silent_unban!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n**>说明：" +
              "\n>解除对发送命令话题的禁止。||";
        } else if (fromChat.is_forum) {
          // commands in General topic
          introduction +=
              "\n*其他位置的命令：*" +
              "\n在与机器人的私聊中：" +
              "\n`.!pm_RUbot_doReset!.`" +
              "\n在对应的 PM 聊天话题中：" +
              "\n`.!pm_RUbot_ban!.`" +
              "\n`.!pm_RUbot_unban!.`" +
              "\n`.!pm_RUbot_silent_ban!.`" +
              "\n`.!pm_RUbot_silent_unban!.`" +
              "\n" +
              "\n*此处有效的命令：*" +
              "\n➡️`.!pm_RUbot_checkInit!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n>检查初始化状态，结果回复将发送至与机器人的私聊。" +
              "\n➡️`.!pm_RUbot_doInit!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n>执行初始化设置，结果回复将发送至与机器人的私聊。" +
              "\n➡️`.!pm_RUbot_doReset!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n>重置设置，结果回复将发送至与机器人的私聊。" +
              "\n";
        } else {
          // commands in bot chat
          introduction +=
              "\n*其他位置的命令：*" +
              "\n在 PM 超级群的常规话题中：" +
              "\n`.!pm_RUbot_checkInit!.`" +
              "\n`.!pm_RUbot_doInit!.`" +
              "\n`.!pm_RUbot_doReset!.`" +
              "\n在对应的 PM 聊天话题中：" +
              "\n`.!pm_RUbot_ban!.`" +
              "\n`.!pm_RUbot_unban!.`" +
              "\n`.!pm_RUbot_silent_ban!.`" +
              "\n`.!pm_RUbot_silent_unban!.`" +
              "\n " +
              "\n*此处有效的命令：*" +
              "\n➡️`.!pm_RUbot_doReset!.`⬅️" +
              "\n↗️*按住或点击复制：*⬆️" +
              "\n>重置设置。" +
              "\n";
        }
      }
      const sendMessageResp = await (await postToTelegramApi(botToken, 'sendMessage', {
        chat_id: fromChat.id,
        text: introduction,
        message_thread_id: message.message_thread_id,
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      })).json();
      if (sendMessageResp.ok) {
        await postToTelegramApi(botToken, 'setMessageReaction', {
          chat_id: fromChat.id,
          message_id: sendMessageResp.result.message_id,
          reaction: [{ type: "emoji", emoji: "🕊" }]
        });
      } else {
        // for parse_mode test
        await postToTelegramApi(botToken, 'sendMessage', {
          chat_id: fromChat.id,
          message_thread_id: message.message_thread_id,
          text: `resp: ${JSON.stringify(sendMessageResp)}`,
        })
      }
      return new Response('OK');
    }


    const reply = message.reply_to_message;
    const check = await doCheckInit(botToken, ownerUid)
    if (!check.failed) {
      const metaDataMessage = check.checkMetaDataMessageResp.result.pinned_message;
      const {
        superGroupChatId,
        topicToFromChat,
        fromChatToTopic,
        bannedTopics,
        topicToCommentName,
        fromChatToCommentName
      } = parseMetaDataMessage(metaDataMessage);
      if (message.forum_topic_created || message.pinned_message) {
        // ignore message types
        return new Response('OK');
      } else if (fromUser.id.toString() === ownerUid && fromChat.id === superGroupChatId
          && fromChat.is_forum && message.is_topic_message) {
        // send message in super group
        if (message.forum_topic_edited?.name) {
          // comment name for topic
          await processTopicCommentNameEdit(
              botToken,
              ownerUid,
              message.message_thread_id,
              topicToFromChat.get(message.message_thread_id),
              message.forum_topic_edited?.name,
              metaDataMessage);
        } else if (message.text === "#del" && reply?.message_id && reply?.from.id === fromUser.id && reply?.message_id !== message.message_thread_id) {
          // delete message
          await processPMDeleteSent(botToken, message, reply, superGroupChatId, topicToFromChat);
        } else {
          // topic PM send to others
          await processPMSent(botToken, message, topicToFromChat);
        }
      } else {
        // send message to bot via chat
        if (message.forum_topic_edited?.name) {
        } else if (message.text === "#fixpin" && reply?.message_id && fromUser.id.toString() === ownerUid) {
          // fix pined message
          await fixPinMessage(botToken, message.chat.id, reply.text, reply.message_id);
        } else if (message.text === "#del" && reply?.message_id && reply?.from.id === fromUser.id) {
          // delete message
          if (!bannedTopics.includes(fromChatToTopic.get(fromChat.id))) {
            await processPMDeleteReceived(botToken, ownerUid, message, reply, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage);
          }
        } else {
          // topic PM receive from others. Always receive first.
          await processPMReceived(botToken, ownerUid, message, superGroupChatId, fromChatToTopic, bannedTopics, metaDataMessage, fromChatToCommentName);
        }
      }
      return new Response('OK');
    }

    if (reply && fromChat.id.toString() === ownerUid) {
      if (message.text === "#fixpin" && reply?.message_id && fromUser.id.toString() === ownerUid) {
        // fix pined message
        await fixPinMessage(botToken, message.chat.id, reply.text, reply.message_id);
        return new Response('OK');
      }

      const rm = reply.reply_markup;
      if (rm && rm.inline_keyboard && rm.inline_keyboard.length > 0) {
        let senderUid = rm.inline_keyboard[0][0].callback_data;
        if (!senderUid) {
          senderUid = rm.inline_keyboard[0][0].url.split('tg://user?id=')[1];
        }

        await postToTelegramApi(botToken, 'copyMessage', {
          chat_id: parseInt(senderUid),
          from_chat_id: fromChat.id,
          message_id: message.message_id
        });
      }

      return new Response('OK');
    }

    const sender = fromChat;
    const senderUid = sender.id.toString();
    const senderName = sender.username ? `@${sender.username}` : [sender.first_name, sender.last_name].filter(Boolean).join(' ');

    const copyMessage = async function (withUrl = false) {
      const ik = [[{
        text: `🔏 From: ${senderName} (${senderUid})`,
        callback_data: senderUid,
      }]];

      if (withUrl) {
        ik[0][0].text = `🔓 From: ${senderName} (${senderUid})`
        ik[0][0].url = `tg://user?id=${senderUid}`;
      }

      return await postToTelegramApi(botToken, 'copyMessage', {
        chat_id: parseInt(ownerUid),
        from_chat_id: fromChat.id,
        message_id: message.message_id,
        reply_markup: { inline_keyboard: ik }
      });
    }

    const response = await copyMessage(true);
    if (!response.ok) {
      await copyMessage();
    }

    return new Response('OK');
  } catch (error) {
    // --- for debugging ---
    await postToTelegramApi(botToken, 'sendMessage', {
      chat_id: ownerUid,
      text: `Error! You can send the message to developer for getting help : ${error.message} Stack: ${error.stack} origin: ${JSON.stringify(update)}`,
    });
    // --- for debugging ---
    return new Response('OK');
  }
}

export async function handleRequest(request, config) {
  const { prefix, secretToken, childBotUrl, childBotSecretToken } = config;

  const url = new URL(request.url);
  const path = url.pathname;

  const INSTALL_PATTERN = new RegExp(`^/${prefix}/install/([^/]+)/([^/]+)$`);
  const UNINSTALL_PATTERN = new RegExp(`^/${prefix}/uninstall/([^/]+)$`);
  const WEBHOOK_PATTERN = new RegExp(`^/${prefix}/webhook/([^/]+)/([^/]+)$`);

  let match;

  if (match = path.match(INSTALL_PATTERN)) {
    return handleInstall(request, match[1], match[2], prefix, secretToken);
  }

  if (match = path.match(UNINSTALL_PATTERN)) {
    return handleUninstall(match[1], secretToken);
  }

  if (match = path.match(WEBHOOK_PATTERN)) {
    return handleWebhook(request, match[1], match[2], secretToken, childBotUrl, childBotSecretToken);
  }

  return new Response('Not Found', { status: 404 });
}
