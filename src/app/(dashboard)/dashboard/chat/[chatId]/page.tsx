import ChatInput from '@/components/ChatInput'
import Messages from '@/components/Messages'
import { fetchRedis } from '@/helpers/redis'
import { authOptions } from '@/lib/auth'
import { db, isGroupChat } from '@/lib/db'
import { messageArrayValidator } from '@/lib/validations/message'
import { GroupChat, Message, User } from '@/types/db'
import { getServerSession } from 'next-auth'
import Image from 'next/image'
import { notFound } from 'next/navigation'

// The following generateMetadata functiion was written after the video and is purely optional
export async function generateMetadata({
  params,
}: {
  params: { chatId: string }
}) {

  
  
  const session = await getServerSession(authOptions)
  if (!session) notFound()

  const { chatId } = await params
  const isGroup = isGroupChat(chatId)

  
const { user } = session

  
  const [userId1, userId2] = chatId.split('--')
  const chatPartnerId = user.id === userId1 ? userId2 : userId1
  const chatPartnerRaw = (await fetchRedis('get', `user:${chatPartnerId}`)) as string
  let chatPartner: User | null = null
  chatPartner = JSON.parse(chatPartnerRaw) as User

  // Get initial messages (you'll need to adapt this to your current message fetching logic)
  const messages = (await fetchRedis(
    'get',
    `user:${chatPartnerId}`
  )) as string // Replace with your actual function
  
  if (isGroup) {
    const groupId = chatId.replace('group:', '')
    const groupData = await db.get(`groups:${groupId}`)
    if (!groupData) notFound()
    
    const group: GroupChat = JSON.parse(groupData as string)
    
    // Check if user is member
    if (!group.members.includes(session.user.id)) {
      notFound()
    }

    const initialMessages = await getChatMessages(chatId)

    return (
      <div className="flex-1 justify-between flex flex-col h-full max-h-[calc(100vh-6rem)]">
        <div className="flex sm:items-center justify-between py-3 border-b-2 border-gray-200">
          <div className="relative flex items-center space-x-4">
            <div className="relative">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-semibold">
                  {group.name.charAt(0).toUpperCase()}
                </span>
              </div>
            </div>
            <div className="flex flex-col leading-tight">
              <div className="text-xl flex items-center">
                <span className="text-gray-700 mr-3 font-semibold">{group.name}</span>
              </div>
              <span className="text-sm text-gray-600">{group.members.length} members</span>
            </div>
          </div>
        </div>

        {/* Use your existing Messages component - you'll need to update it to handle groups */}
        <Messages
          chatId={chatId}
            chatPartner={null} // null for groups
            sessionImg={user.image}
            sessionId={user.id}
            initialMessages={initialMessages}
            isGroup={true}
        />
        
        {/* Use your existing ChatInput component */}
        <ChatInput chatId={chatId} chatPartner={null} />
      </div>
    )
  }else{


  
    const [userId1, userId2] = chatId.split('--')
    const { user } = session

    const chatPartnerId = user.id === userId1 ? userId2 : userId1
    const chatPartnerRaw = (await fetchRedis(
      'get',
      `user:${chatPartnerId}`
    )) as string
    const chatPartner = JSON.parse(chatPartnerRaw) as User

    return { title: `FriendZone | ${chatPartner.name} chat` }
  }
}

interface PageProps {
  params: {
    chatId: string
  }
}

async function getChatMessages(chatId: string) {
  try {
    const results: string[] = await fetchRedis(
      'zrange',
      `chat:${chatId}:messages`,
      0,
      -1
    )

    const dbMessages = results.map((message) => JSON.parse(message) as Message)

    const reversedDbMessages = dbMessages.reverse()

    const messages = messageArrayValidator.parse(reversedDbMessages)


    return messages
  } catch (error) {
    notFound()
  }
}

const page = async ({ params }: PageProps) => {
  const { chatId } = await params
  const session = await getServerSession(authOptions)
  if (!session) notFound()

  const { user } = session

  const [userId1, userId2] = chatId.split('--')

  if (user.id !== userId1 && user.id !== userId2) {
    notFound()
  }

  const chatPartnerId = user.id === userId1 ? userId2 : userId1
  

  const chatPartnerRaw = (await fetchRedis(
    'get',
    `user:${chatPartnerId}`
  )) as string
  const chatPartner = JSON.parse(chatPartnerRaw) as User
  const initialMessages = await getChatMessages(chatId)
  
  console.log('Session user ID:', session.user.id)
  console.log('Initial messages:', initialMessages.map(m => ({
    id: m.id,
    senderId: m.senderId,
    isCurrentUser: m.senderId === session.user.id,
    text: m.text.substring(0, 20)
  })))

  return (
    <div className='flex-1 justify-between flex flex-col h-full max-h-[calc(100vh-6rem)]'>
      <div className='flex sm:items-center justify-between py-3 border-b-2 border-gray-200'>
        <div className='relative flex items-center space-x-4'>
          <div className='relative'>
            <div className='relative w-8 sm:w-12 h-8 sm:h-12'>
              <Image
                fill
                referrerPolicy='no-referrer'
                src={chatPartner.image}
                alt={`${chatPartner.name} profile picture`}
                className='rounded-full'
              />
            </div>
          </div>

          <div className='flex flex-col leading-tight'>
            <div className='text-xl flex items-center'>
              <span className='text-gray-700 mr-3 font-semibold'>
                {chatPartner.name}
              </span>
            </div>

            <span className='text-sm text-gray-600'>{chatPartner.email}</span>
          </div>
        </div>
      </div>

      <Messages
        chatId={chatId}
        chatPartner={chatPartner}
        sessionImg={session.user.image}
        sessionId={session.user.id}
        initialMessages={initialMessages} 
        isGroup={false}      />
      <ChatInput chatId={chatId} chatPartner={chatPartner} />
    </div>
  )
  
}

export default page
