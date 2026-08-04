import "dotenv/config"
import { prisma } from "@/lib/prisma"
import { verifyAuth } from "@/lib/verifyAuth"

async function assertMember(groupId: string, pubkey: string) {
  const membership = await prisma.groupChatMember.findUnique({
    where: { groupId_pubkey: { groupId, pubkey } },
  })
  return Boolean(membership)
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(request)
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: groupId } = await params

  try {
    const isMember = await assertMember(groupId, auth.pubkey)
    if (!isMember) {
      return Response.json({ error: "You're not a member of this group." }, { status: 403 })
    }

    const messages = await prisma.groupMessage.findMany({
      where: { groupId },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { sender: { select: { pubkey: true, username: true } } },
    })

    return Response.json({
      messages: messages.map((m) => ({
        id: m.id,
        groupId: m.groupId,
        senderPubkey: m.senderPubkey,
        senderName: m.sender.username,
        body: m.body,
        createdAt: m.createdAt,
      })),
    })
  } catch (error) {
    console.error("Failed to fetch group messages:", error)
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(request)
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: groupId } = await params

  try {
    const isMember = await assertMember(groupId, auth.pubkey)
    if (!isMember) {
      return Response.json({ error: "You're not a member of this group." }, { status: 403 })
    }

    const body = await request.json()
    const text = String(body?.body ?? "").trim()

    if (!text) {
      return Response.json({ error: "Message body is required" }, { status: 400 })
    }
    if (text.length > 2000) {
      return Response.json({ error: "Message is too long (max 2000 characters)" }, { status: 400 })
    }

    const message = await prisma.groupMessage.create({
      data: { groupId, senderPubkey: auth.pubkey, body: text },
    })

    const otherMembers = await prisma.groupChatMember.findMany({
      where: { groupId, pubkey: { not: auth.pubkey } },
      select: { pubkey: true },
    })
    const group = await prisma.groupChat.findUnique({ where: { id: groupId }, select: { name: true } })

    await Promise.all(
      otherMembers.map((m) =>
        prisma.notification.create({
          data: {
            pubkey: m.pubkey,
            message: `New message in "${group?.name ?? "group"}"`,
            vaultId: null,
            variant: "info",
            meta: {
              event: "group_message_received",
              groupId,
              senderPubkey: auth.pubkey,
              messageId: message.id,
              timestamp: new Date().toISOString(),
            },
          },
        })
      )
    ).catch((err) => console.error("Failed to notify group members:", err))

    return Response.json({
      message: {
        id: message.id,
        groupId: message.groupId,
        senderPubkey: message.senderPubkey,
        body: message.body,
        createdAt: message.createdAt,
      },
    }, { status: 201 })
  } catch (error) {
    console.error("Failed to send group message:", error)
    return Response.json({ error: "Failed to send message" }, { status: 500 })
  }
}