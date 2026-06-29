import { OrderForm } from "@/components/orders/order-form";

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderForm mode="edit" orderId={id} />;
}
