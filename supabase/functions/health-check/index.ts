import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    // Get Supabase credentials from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey)
    
    // Test database connection by counting regions
    const { data: regions, error } = await supabase
      .from('regions')
      .select('*')
    
    if (error) throw error
    
    // Test counting states
    const { data: states, error: statesError } = await supabase
      .from('states')
      .select('*')
    
    if (statesError) throw statesError
    
    // Test counting lodges
    const { data: lodges, error: lodgesError } = await supabase
      .from('lodges')
      .select('*')
    
    if (lodgesError) throw lodgesError
    
    // Success response
    return new Response(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          regions: regions?.length || 0,
          states: states?.length || 0,
          lodges: lodges?.length || 0
        },
        message: 'Appalachian Region Dashboard is running!'
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  } catch (error) {
    console.error('Health check error:', error)
    
    return new Response(
      JSON.stringify({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})
