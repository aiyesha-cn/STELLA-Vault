import "dotenv/config"
import { prisma } from "@/lib/prisma"
import { verifyAuth } from "@/lib/verifyAuth"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(request)
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: groupId } = await params

  try {
    const group = await prisma.groupChat.findUnique({ where: { id: groupId } })
    if (!group) {
      return Response.json({ error: "Group not found" }, { status: 404 })
    }

    const membership = await prisma.groupChatMember.findUnique({
      where: { groupId_pubkey: { groupId, pubkey: auth.pubkey } },
    })
    if (!membership) {
      return Response.json({ error: "You're not a member of this group." }, { status: 403 })
    }

    const wasAdmin = group.createdBy === auth.pubkey

    await prisma.$transaction(async (tx) => {
      await tx.groupChatMember.delete({
        where: { groupId_pubkey: { groupId, pubkey: auth.pubkey } },
      })

      if (wasAdmin) {
        const nextAdmin = await tx.groupChatMember.findFirst({
          where: { groupId },
          orderBy: { joinedAt: "asc" },
        })

        if (nextAdmin) {
          await tx.groupChat.update({
            where: { id: groupId },
            data: { createdBy: nextAdmin.pubkey },
          })
        } else {
          // No members left — remove the now-empty group entirely
          await tx.groupChat.delete({ where: { id: groupId } })
        }
      }
    })

    return Response.json({ success: true })
  } catch (error) {
    console.error("Failed to leave group:", error)
    return Response.json({ error: "Failed to leave group" }, { status: 500 })
  }
}