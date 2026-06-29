import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OrdersPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders dashboard</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The orders table and filters arrive in OE-P2.
      </CardContent>
    </Card>
  );
}
