import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import CustomerManager from '@/components/customers/CustomerManager'

export default async function CustomersPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const { data: customers } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div>
      <Header title="Customers" userId={userId!} />
      <div className="p-6">
        <CustomerManager customers={customers || []} userId={userId!} />
      </div>
    </div>
  )
}
