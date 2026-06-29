import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TrackingPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operations</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The 7-stage operations workflow arrives in OE-P3.
      </CardContent>
    </Card>
  );
}
