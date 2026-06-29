import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewOrderPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>New order</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The order entry form arrives in OE-P2.
      </CardContent>
    </Card>
  );
}
