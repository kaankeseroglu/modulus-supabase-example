import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Channel = "email" | "sms";

type NotificationRequest = {
  production_id: string;
  subject?: string;
  body: string;
  channels: Channel[];
};

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as NotificationRequest;

    if (!payload.production_id || !payload.body || !Array.isArray(payload.channels)) {
      return json({ error: "production_id, body, and channels are required" }, 400);
    }

    const supabaseUrl = mustGetEnv("SUPABASE_URL");
    const anonKey = mustGetEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: canEdit, error: canEditError } = await userClient.rpc("can_edit_production", {
      production: payload.production_id,
    });

    if (canEditError || canEdit !== true) {
      return json({ error: "Not allowed to send notifications for this production" }, 403);
    }

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "A valid authenticated user is required" }, 401);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: notification, error: notificationError } = await serviceClient
      .from("notifications")
      .insert({
        production_id: payload.production_id,
        subject: payload.subject ?? "Show update",
        body: payload.body,
        channels: payload.channels,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (notificationError) throw notificationError;

    const { data: contacts, error: contactsError } = await serviceClient
      .from("contacts")
      .select("id, name, email, phone")
      .eq("production_id", payload.production_id)
      .eq("is_private", false);

    if (contactsError) throw contactsError;

    const deliveries = [];

    for (const contact of (contacts ?? []) as Contact[]) {
      for (const channel of payload.channels) {
        const destination = channel === "email" ? contact.email : contact.phone;

        if (!destination) {
          deliveries.push({
            notification_id: notification.id,
            contact_id: contact.id,
            channel,
            destination,
            status: "skipped",
            error: `No ${channel} destination for ${contact.name}`,
          });
          continue;
        }

        const result =
          channel === "email"
            ? await sendEmail(destination, payload.subject ?? "Show update", payload.body)
            : await sendSms(destination, payload.body);

        deliveries.push({
          notification_id: notification.id,
          contact_id: contact.id,
          channel,
          destination,
          provider_message_id: result.providerMessageId,
          status: result.ok ? "sent" : "failed",
          error: result.error,
        });
      }
    }

    if (deliveries.length > 0) {
      const { error: deliveriesError } = await serviceClient
        .from("notification_deliveries")
        .insert(deliveries);

      if (deliveriesError) throw deliveriesError;
    }

    return json({
      notification_id: notification.id,
      attempted: deliveries.length,
      sent: deliveries.filter((delivery) => delivery.status === "sent").length,
      skipped: deliveries.filter((delivery) => delivery.status === "skipped").length,
      failed: deliveries.filter((delivery) => delivery.status === "failed").length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

function mustGetEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function sendEmail(to: string, subject: string, text: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");

  if (!apiKey) {
    return {
      ok: false,
      error: "RESEND_API_KEY is not configured",
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Modulus Demo <notifications@example.com>",
      to,
      subject,
      text,
    }),
  });

  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    providerMessageId: data?.id,
    error: response.ok ? undefined : JSON.stringify(data),
  };
}

async function sendSms(to: string, body: string) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");

  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      error: "Twilio secrets are not fully configured",
    };
  }

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", body);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );

  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    providerMessageId: data?.sid,
    error: response.ok ? undefined : JSON.stringify(data),
  };
}
