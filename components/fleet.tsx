import Image from "next/image"
import { Users, Briefcase, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"

const vehicles = [
  {
    name: "Sedán Ejecutivo",
    description:
      "Perfecto para traslados ejecutivos y viajes al aeropuerto. Máximo confort y elegancia.",
    image: "/images/fleet-sedan.jpg",
    passengers: "3 pasajeros",
    luggage: "2 maletas",
    features: "Wi-Fi a bordo",
  },
  {
    name: "SUV Premium",
    description:
      "Ideal para familias y grupos pequeños. Amplio espacio interior con acabados de lujo.",
    image: "/images/fleet-suv.jpg",
    passengers: "5 pasajeros",
    luggage: "4 maletas",
    features: "Wi-Fi a bordo",
  },
  {
    name: "Van Ejecutiva",
    description:
      "La mejor opción para grupos y eventos corporativos. Asientos reclinables y barra de servicio.",
    image: "/images/fleet-van.jpg",
    passengers: "12 pasajeros",
    luggage: "8 maletas",
    features: "Wi-Fi a bordo",
  },
]

export function Fleet() {
  return (
    <section id="flota" className="border-t border-border bg-card py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-primary">
            Nuestra Flota
          </p>
          <h2 className="mt-4 font-serif text-4xl font-bold tracking-tight text-card-foreground sm:text-5xl text-balance">
            Vehículos de alta gama
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Cada vehículo de nuestra flota es seleccionado cuidadosamente para
            garantizar la máxima comodidad y seguridad.
          </p>
        </div>

        {/* Vehicles */}
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <div
              key={vehicle.name}
              className="group overflow-hidden border border-border transition-all duration-300 hover:border-primary/50"
            >
              <div className="relative h-64 overflow-hidden">
                <Image
                  src={vehicle.image}
                  alt={vehicle.name}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-6">
                <h3 className="font-serif text-2xl font-semibold text-card-foreground">
                  {vehicle.name}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {vehicle.description}
                </p>
                <div className="mt-6 flex items-center gap-6 border-t border-border pt-6">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    {vehicle.passengers}
                  </div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Briefcase className="h-4 w-4 text-primary" />
                    {vehicle.luggage}
                  </div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Wifi className="h-4 w-4 text-primary" />
                    {vehicle.features}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="mt-6 w-full rounded-none border-border text-foreground hover:bg-primary hover:text-primary-foreground uppercase tracking-widest text-xs font-semibold"
                >
                  Reservar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
