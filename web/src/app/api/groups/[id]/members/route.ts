import "dotenv/config"
import { prisma } from "@/lib/prisma"
import { verifyAuth } from "@/lib/verifyAuth"
import { StrKey } from "@stellar/stellar-sdk"

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
    if (group.createdBy !== auth.pubkey) {
      return Response.json({ error: "Only the group admin can add members." }, { status: 403 })
    }

    const body = await request.json()
    const rawMembers: unknown[] = Array.isArray(body?.memberPubkeys) ? body.memberPubkeys : []
    const memberPubkeys = Array.from(new Set(rawMembers.map((p) => String(p).trim()).filter(Boolean)))

    if (memberPubkeys.length === 0) {
      return Response.json({ error: "Provide at least one address to add" }, { status: 400 })
    }

    for (const pubkey of memberPubkeys) {
      if (!StrKey.isValidEd25519PublicKey(pubkey)) {
        return Response.json({ error: `Invalid Stellar address: ${pubkey}` }, { status: 400 })
      }
    }

    const existingUsers = await prisma.user.findMany({
      where: { pubkey: { in: memberPubkeys } },
      select: { pubkey: true },
    })
    const existingPubkeys = new Set(existingUsers.map((u) => u.pubkey))
    const missing = memberPubkeys.filter((p) => !existingPubkeys.has(p))
    if (missing.length > 0) {
      return Response.json({ error: "This user doesn't exist.", missing }, { status: 404 })
    }

    const currentMembers = await prisma.groupChatMember.findMany({
      where: { groupId },
      select: { pubkey: true },
    })
    const alreadyIn = new Set(currentMembers.map((m) => m.pubkey))
    const toAdd = memberPubkeys.filter((p) => !alreadyIn.has(p))

    if (toAdd.length === 0) {
      return Response.json({ error: "All provided users are already members." }, { status: 400 })
    }

    await prisma.groupChatMember.createMany({
      data: toAdd.map((pubkey) => ({ groupId, pubkey })),
    })

    return Response.json({ added: toAdd }, { status: 201 })
  } catch (error) {
    console.error("Failed to add group members:", error)
    return Response.json({ error: "Failed to add members" }, { status: 500 })
  }
}