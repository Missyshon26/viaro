import {z} from "zod"
export const formSchema = z.object({
    fullName: z.string().trim().min(2, "Please enter your full name").max(70, "Please keep your name under 70 characters"),
    phone: z.string().trim().min(7, "Please enter a phone number we can reach you on"),
    email: z.string().trim().email("Please enter a valid email address"),
    message: z.string().trim().min(2, "Tell us a little about your trip"),
})
