import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ICS parsing library
import ICAL from 'https://esm.sh/ical.js@1.5.0'

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseKey)
    
    console.log('Starting Warhorn ICS scraper...')
    
    // Get all active lodges with Warhorn ICS URLs
    const { data: lodges, error: lodgesError } = await supabase
      .from('lodges')
      .select('id, name, warhorn_url, warhorn_ics_url')
      .eq('is_active', true)
      .not('warhorn_ics_url', 'is', null)
    
    if (lodgesError) throw lodgesError
    
    console.log(`Found ${lodges.length} lodges with Warhorn feeds`)
    
    const results = []
    
    for (const lodge of lodges) {
      try {
        console.log(`Scraping ${lodge.name}...`)
        
        // Fetch ICS feed
        const icsUrl = lodge.warhorn_ics_url || `${lodge.warhorn_url}/ics`
        const response = await fetch(icsUrl)
        
        if (!response.ok) {
          console.error(`Failed to fetch ${lodge.name}: ${response.status}`)
          continue
        }
        
        const icsText = await response.text()
        
        // Parse ICS data
        const jcalData = ICAL.parse(icsText)
        const comp = new ICAL.Component(jcalData)
        const vevents = comp.getAllSubcomponents('vevent')
        
        console.log(`Found ${vevents.length} events for ${lodge.name}`)
        
        let eventsProcessed = 0
        
        for (const vevent of vevents) {
          const event = new ICAL.Event(vevent)
          
          // Extract event data
          const eventData = {
            lodge_id: lodge.id,
            source: 'warhorn_ics',
            warhorn_id: event.uid,
            event_title: event.summary,
            event_date: event.startDate.toJSDate().toISOString(),
            event_end_date: event.endDate?.toJSDate().toISOString(),
            location: event.location,
            description: event.description,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString()
          }
          
          // Detect game system FIRST (helps with subsequent parsing)
if (eventData.event_title.match(/PFS2|Pathfinder.*2E|PF2 AP/i)) {
  eventData.game_system = 'PFS2'
} else if (eventData.event_title.match(/SFS2|Starfinder.*2E|SF2/i)) {
  eventData.game_system = 'SFS2'
} else if (eventData.event_title.match(/PFS1|PFS(?!\d)|Pathfinder.*1E|PF1/i)) {
  eventData.game_system = 'PFS1'
} else if (eventData.event_title.match(/SFS1|SFS(?!\d)|Starfinder.*1E|SF1/i)) {
  eventData.game_system = 'SFS1'
}

// Extract scenario code - multiple patterns
let scenarioCode = null

// Pattern 1: Standard scenarios (PFS2 1-01, SFS2 #2-03, etc.)
// Must come BEFORE other patterns to avoid false matches
let match = eventData.event_title.match(/(?:PFS2?|SFS2?)[\s#-]*(\d+-\d+)/i)
if (match) {
  scenarioCode = match[0].toUpperCase().replace(/\s+/g, ' ')
}

// Pattern 2: Adventure Paths (PF2 AP 190, AP 163, etc.)
// Only match if no standard scenario code found
if (!scenarioCode) {
  match = eventData.event_title.match(/(?:PF2?\s+)?AP\s+(\d+)/i)
  if (match) {
    scenarioCode = `PFS2 AP ${match[1]}`
    eventData.adventure_type = 'Adventure Path'
  }
}

// Pattern 3: Intro scenarios - MUST be "Intro 1" or "Intro 2" as standalone
// Not "Introduction" or "Intro:" which are just part of scenario titles
if (!scenarioCode) {
  match = eventData.event_title.match(/\bIntro\s+([12])\b/i)
  if (match) {
    const introNum = match[1]
    scenarioCode = `${eventData.game_system} 99-0${introNum}`
    eventData.adventure_type = 'Intro Scenario'
  }
}

if (scenarioCode) {
  eventData.scenario_code = scenarioCode
}

// Detect quest
if (eventData.event_title.match(/\bquest\b/i)) {
  eventData.is_quest = true
  eventData.adventure_type = 'Quest'
}
          
          // Check if event already exists (by warhorn_id)
          const { data: existing } = await supabase
            .from('feed_event_history')
            .select('id')
            .eq('warhorn_id', eventData.warhorn_id)
            .single()
          
          if (existing) {
            // Update last_seen
            await supabase
              .from('feed_event_history')
              .update({ last_seen: eventData.last_seen })
              .eq('id', existing.id)
          } else {
            // Insert new event
            const { error: insertError } = await supabase
              .from('feed_event_history')
              .insert(eventData)
            
            if (insertError) {
              console.error(`Error inserting event: ${insertError.message}`)
            } else {
              eventsProcessed++
            }
          }
        }
        
        results.push({
          lodge: lodge.name,
          eventsFound: vevents.length,
          eventsProcessed
        })
        
      } catch (error) {
        console.error(`Error processing ${lodge.name}:`, error.message)
        results.push({
          lodge: lodge.name,
          error: error.message
        })
      }
    }
    
    return new Response(
      JSON.stringify({
        status: 'success',
        timestamp: new Date().toISOString(),
        lodgesProcessed: lodges.length,
        results
      }),
      {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
    
  } catch (error) {
    console.error('Scraper error:', error)
    
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