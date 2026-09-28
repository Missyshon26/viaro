"use client";
import { Star } from "lucide-react";
import { getDictionary } from "@/lib/get-dictionary";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Testimonial = {
  name: string;
  role: string;
  text: string;
  rating: number;
};

type TestimonialsProps = {
  data: Testimonial[];
};

export function Testimonials({ data }: TestimonialsProps) {
  const params = useParams();
    const [dict, setDict] = useState<any>(null);

  useEffect(() => {
    const loadDict = async () => {
      const data = await getDictionary();
      setDict(data);
    };

    loadDict();
  }, []);

  if (!dict) return <div>Loading...</div>;
  const t = dict.testimo;
  return (
    <section id="testimonials" className="py-2">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {data.map((testimonial) => (
            <div
              key={testimonial.text}
              className="border rounded-xl p-8 transition-all duration-300 border-primary/50"
            >
              <div className="">
                <p className="font-serif text-lg font-semibold text-card-foreground">
                  {testimonial.role}
                </p>
              </div>
              <div className="flex gap-1 mt-3 border-t border-border pt-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star
                    key={i}
                    className="h-4 w-4 fill-brand text-brand"
                  />
                ))}
              </div>

              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
                {`"${testimonial.text}"`}
                 </p>
                <p className="mt-1 text-white text-xs uppercase">
                  {testimonial.name}
                </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
