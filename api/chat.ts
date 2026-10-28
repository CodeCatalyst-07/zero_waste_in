import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';
import { loadConfig } from './_lib/config.js';
import { consumeRateLimitToken } from './_lib/rate-limit.js';

export interface VercelRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[]>;
  cookies?: Record<string, string>;
}

export interface VercelResponse extends ServerResponse {
  status(statusCode: number): VercelResponse;
  json(jsonBody: unknown): VercelResponse;
  send(body: unknown): VercelResponse;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const CIVIC_ASSISTANT_SYSTEM_PROMPT = `You are the ZeroWasteIN Civic Eco-Assistant, powered by Google Gemma models.
You are an expert on:
1. India's Solid Waste Management Rules 2026 (SWM Rules 2026):
   - Stream 01 (Wet / Organic Waste): Green Bin (fruit/veggie peels, cooked food, tea leaves, floral waste, meat scraps). Decomposes aerobically in municipal composting.
   - Stream 02 (Dry / Recyclables): Blue Bin (rinsed plastic containers, PET bottles, clean cardboard, paper, metal cans, glass bottles). Recycled at Material Recovery Facilities (MRF).
   - Stream 03 (Sanitary Waste): Marked Red Pouch / Bin (diapers, sanitary pads, bandages, swabs, personal hygiene products). Wrapped in newspaper/red pouch for high-temperature incineration.
   - Stream 04 (Special Care / Domestic Hazardous): Hazard Container (button cells, alkaline/lithium batteries, CFL tubes, LED lights, paint cans, thinners, expired medicines, thermometers, e-waste). Channelled to authorized recyclers/TSDF.
2. Household Carbon & Utility Footprint Accounting:
   - India National CEA Baseline v22 factor: 0.675 kg CO2e / kWh of grid electricity.
   - CPHEEO Urban Benchmark: 135 Litres / capita / day water consumption.
   - Commute: Metro rail (0.015 kg CO2e/km) vs EV scooter (0.035 kg/km) vs ICE car (0.140 kg/km).

Provide concise, accurate, helpful, and courteous advice in plain English.
Keep answers structured and under 150 words unless the citizen asks for detailed statutory procedures.
Never give unsafe chemical mixing advice. Always emphasize safety (e.g. wrap broken glass or blades before disposal).`;

/**
 * Serverless endpoint for interactive chatbot queries using Google Gemma via Jarvis Labs.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const requestId = crypto.randomUUID();

  // 1. Method verification
  if (req.method !== 'POST') {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Only POST is supported.' } });
    return;
  }

  // 2. Body parsing
  let body = req.body as Record<string, unknown> | undefined;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Invalid JSON body.' } });
      return;
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Body must be a JSON object.' } });
    return;
  }

  const rawMessage = body['message'];
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'Field "message" must be a non-empty string.' } });
    return;
  }

  const userMessage = rawMessage.trim().slice(0, 500);

  // Parse optional conversation history
  const rawHistory = body['history'];
  const history: ChatMessage[] = [];
  if (Array.isArray(rawHistory)) {
    for (const item of rawHistory.slice(-8)) {
      if (
        item &&
        typeof item === 'object' &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string'
      ) {
        history.push({
          role: item.role,
          content: item.content.slice(0, 500),
        });
      }
    }
  }

  // 3. Rate limiting check
  const rawIpHeader = req.headers
    ? (req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'])
    : undefined;
  const clientIp =
    typeof rawIpHeader === 'string' ? rawIpHeader.split(',')[0]?.trim() || 'anon' : 'anon';

  const config = loadConfig();
  if (!consumeRateLimitToken(`chat:${clientIp}`, config.rateLimitPerMinute * 2)) {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many messages. Please wait a moment.' },
    });
    return;
  }

  // 4. Dispatch to Google Gemma on Jarvis Labs (primary)
  if (config.jarvis?.apiKey) {
    try {
      const messages = [
        { role: 'system', content: CIVIC_ASSISTANT_SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userMessage },
      ];

      const url = `${config.jarvis.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const jarvisResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.jarvis.apiKey}`,
        },
        body: JSON.stringify({
          model: config.jarvis.model || 'gemma-4-31b-it',
          messages,
          max_tokens: 600,
          temperature: 0.3,
          ...(config.jarvis.extraBodyJson ?? {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (jarvisResponse.ok) {
        const data = (await jarvisResponse.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) {
          res.status(200).json({
            reply,
            model: config.jarvis.model,
            provider: 'jarvis',
            requestId,
          });
          return;
        }
      }
    } catch (err) {
      console.warn('Jarvis Labs Gemma chat error, attempting fallback:', err);
    }
  }

  // 5. Fallback to Google Gemini / Gemma if configured
  if (config.gemini?.apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
      const response = await ai.models.generateContent({
        model: config.gemini.modelPrimary || 'gemini-2.5-flash',
        contents: [
          {
            text: `${CIVIC_ASSISTANT_SYSTEM_PROMPT}\n\nUser Question: ${userMessage}`,
          },
        ],
      });

      const reply = response.text?.trim();
      if (reply) {
        res.status(200).json({
          reply,
          model: config.gemini.modelPrimary,
          provider: 'gemini',
          requestId,
        });
        return;
      }
    } catch (geminiErr) {
      console.warn('Gemini chat fallback error:', geminiErr);
    }
  }

  // 6. Graceful knowledge-base fallback if no external API keys are configured
  const fallbackReply = generateCivicFallback(userMessage);
  res.status(200).json({
    reply: fallbackReply,
    model: 'gemma-civic-rules',
    provider: 'local-rules',
    requestId,
  });
}

/**
 * Provides immediate statutory waste guidance if AI inference endpoints are unreachable.
 */
function generateCivicFallback(query: string): string {
  const q = query.toLowerCase();

  if (q.includes('battery') || q.includes('cell')) {
    return 'Under SWM Rules 2026, batteries (button, AA, lithium) belong in Stream 04 (Special Care / Domestic Hazardous). Store in a dry box and hand over to municipal e-waste collection or authorized battery deposit centers.';
  }
  if (q.includes('bulb') || q.includes('cfl') || q.includes('tube')) {
    return 'CFL bulbs and fluorescent tubes contain toxic mercury vapour. Under Stream 04 (Special Care), place them wrapped in original sleeve or cardboard box to prevent breakage before municipal handover.';
  }
  if (q.includes('diaper') || q.includes('sanitary') || q.includes('pad')) {
    return 'Under Schedule II, sanitary napkins and diapers must be wrapped securely in newspaper or biodegradable pouches marked with a visible red cross, and placed in Stream 03 (Sanitary Waste) for common biomedical incineration.';
  }
  if (q.includes('medicine') || q.includes('blister') || q.includes('pill') || q.includes('drug')) {
    return 'Expired medicines and empty blister packs belong to Stream 04 (Special Care / Hazardous). Never flush medicines down the toilet. Return to pharmacy take-back boxes or municipal hazardous waste points.';
  }
  if (q.includes('peel') || q.includes('food') || q.includes('fruit') || q.includes('vegetable')) {
    return 'Food scraps and peels go directly into Stream 01 (Wet / Organic Waste - Green Bin). Do not pack in conventional plastic carry bags. Wet waste is composted locally or biomethanated.';
  }
  if (q.includes('plastic') || q.includes('bottle') || q.includes('can') || q.includes('paper') || q.includes('cardboard')) {
    return 'Clean paper, cardboard, PET bottles, and metal cans belong in Stream 02 (Dry Waste - Blue Bin). Rinse food residue and flatten containers before binning to ensure high recycling value.';
  }
  if (q.includes('carbon') || q.includes('electricity') || q.includes('kwh')) {
    return 'Under CEA Baseline v22, each 1 kWh of Indian grid electricity emits 0.675 kg CO2e. You can track and log your monthly electricity usage in the Footprint tab to calculate your household emission footprint.';
  }
  if (q.includes('water')) {
    return 'The CPHEEO national urban benchmark allocates 135 Litres per capita per day for domestic household needs. Check the Footprint tab to compare your household usage against this standard.';
  }

  return 'Under India\'s Solid Waste Management Rules 2026, waste must be segregated into 4 streams at source: Green (Wet/Organic), Blue (Dry/Recyclable), Red-marked (Sanitary), and Hazardous (Special Care). You can use our Sort tab camera or search bar to classify any specific item!';
}
