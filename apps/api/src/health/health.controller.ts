import { Controller, Get } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { Public } from "../auth/decorators";

@Public()
@Controller("healthz")
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  health() {
    return {
      status: "ok",
      mongo: this.connection.readyState === 1 ? "connected" : "disconnected",
      time: new Date().toISOString(),
    };
  }
}
