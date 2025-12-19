
import type { APIRoute } from "astro";
import { getSessionCookie, verifySessionCookie } from "@/lib/firebase/auth";

export const POST: APIRoute = async ({ request, redirect }) => {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
        return new Response("Unauthorized", { status: 401 });
    }

    const decodedClaims = await verifySessionCookie(sessionCookie);
    if (!decodedClaims) {
        return new Response("Unauthorized", { status: 401 });
    }

    const userEmail = decodedClaims.email;
    const userId = decodedClaims.uid;

    if (!userEmail) {
        return new Response("User email required", { status: 400 });
    }

    try {
        const formData = await request.formData();
        const type = formData.get("type"); // 'subscription' or 'credits'
        const amountStr = formData.get("amount"); // in cents (e.g., 1000 = $10.00)
        const plan = formData.get("plan"); // 'pro'
        const pkg = formData.get("package"); // 'starter', 'creator', 'studio'

        if (!amountStr || !type) {
            return new Response("Missing required fields", { status: 400 });
        }

        const amount = parseInt(amountStr.toString());

        // Call Paystack Initialize API
        const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${import.meta.env.PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email: userEmail,
                amount: amount, // Paystack expects amount in Kobo/Cents
                currency: "USD",
                callback_url: `${new URL(request.url).origin}/payment/success`, // Simple success page
                metadata: {
                    uid: userId,
                    type: type,
                    plan: plan,
                    package: pkg,
                    custom_fields: [
                        {
                            display_name: "Payment Type",
                            variable_name: "payment_type",
                            value: type,
                        },
                        {
                            display_name: "User ID",
                            variable_name: "user_id",
                            value: userId
                        }
                    ],
                },
            }),
        });

        const data = await paystackResponse.json();

        if (!data.status) {
            console.error("Paystack initialization failed:", data);
            return new Response(data.message || "Payment initialization failed", { status: 400 });
        }

        // Redirect user to Paystack checkout
        return redirect(data.data.authorization_url);

    } catch (error) {
        console.error("Payment error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};
