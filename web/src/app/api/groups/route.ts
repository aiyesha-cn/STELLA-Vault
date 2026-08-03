import "dotenv/config"
import { prisma } from "@/lib/prisma"
import { verifyAuth } from "@/lib/verifyAuth"
import { StrKey } from "@stellar/stellar-sdk"

export async function GET(request: Request) {
  const auth = await verifyAuth(request)
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const memberships = await prisma.groupChatMember.findMany({
      where: { pubkey: auth.pubkey },
      include: {
        group: {
          include: {
            members: { include: { user: { select: { pubkey: true, username: true } } } },
          },
        },
      },
      orderBy: { group: { createdAt: "desc" } },
    })

     const groups = memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      createdAt: m.group.createdAt,
      createdBy: m.group.createdBy,
      memberCount: m.group.members.length,
      members: m.group.members.map((gm) => ({ pubkey: gm.user.pubkey, username: gm.user.username })),
    }))

    return Response.json({ groups })
  } catch (error) {
    console.error("Failed to fetch groups:", error)
    return Response.json({ error: "Failed to fetch groups" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await verifyAuth(request)
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const name = String(body?.name ?? "").trim()
    const rawMembers: unknown[] = Array.isArray(body?.memberPubkeys) ? body.memberPubkeys : []

    if (!name) {
      return Response.json({ error: "Group name is required" }, { status: 400 })
    }

    const memberPubkeys = Array.from(
      new Set(rawMembers.map((p) => String(p).trim()).filter((p) => p && p !== auth.pubkey))
    )

    if (memberPubkeys.length === 0) {
      return Response.json({ error: "Add at least one other member" }, { status: 400 })
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

    const group = await prisma.groupChat.create({
      data: {
        name,
        createdBy: auth.pubkey,
        members: {
          create: [auth.pubkey, ...memberPubkeys].map((pubkey) => ({ pubkey })),
        },
      },
      include: {
        members: { include: { user: { select: { pubkey: true, username: true } } } },
      },
    })

    return Response.json({
      group: {
        id: group.id,
        name: group.name,
        createdAt: group.createdAt,
        memberCount: group.members.length,
        members: group.members.map((gm) => ({ pubkey: gm.user.pubkey, username: gm.user.username })),
      },
    }, { status: 201 })
  } catch (error) {
    console.error("Failed to create group:", error)
    return Response.json({ error: "Failed to create group" }, { status: 500 })
  }
}