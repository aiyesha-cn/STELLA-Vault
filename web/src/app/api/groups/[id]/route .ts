import "dotenv/config"
import { prisma } from "@/lib/prisma"
import { verifyAuth } from "@/lib/verifyAuth"

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    if (group.createdBy !== auth.pubkey) {
      return Response.json({ error: "Only the group admin can delete this group." }, { status: 403 })
    }

    await prisma.groupChat.delete({ where: { id: groupId } })

    return Response.json({ success: true })
  } catch (error) {
    console.error("Failed to delete group:", error)
    return Response.json({ error: "Failed to delete group" }, { status: 500 })
  }
}