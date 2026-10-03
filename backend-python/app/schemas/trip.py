"""Trip request/response schemas."""

from pydantic import BaseModel


class CityDestination(BaseModel):
    name: str
    days: int


class BudgetSchema(BaseModel):
    total: float
    travel: float
    accommodation: float
    food: float
    events: float


class CreateTripRequest(BaseModel):
    title: str
    description: str | None = None
    startDate: str | None = None
    startLocation: str | None = None
    cities: list[CityDestination] = []
    totalDays: int | None = None
    people: int = 1
    travelType: str = "cultural"
    budget: BudgetSchema | None = None
    budgetMode: str = "capped"
    generatedItinerary: dict | None = None
    travelMeans: dict | None = None
    tripState: dict | None = None
    chatHistory: list | None = None
    conversationId: str | None = None
    isPublic: bool = False
    tags: list[str] = []


class UpdateTripRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    startDate: str | None = None
    startLocation: str | None = None
    cities: list[CityDestination] | None = None
    totalDays: int | None = None
    people: int | None = None
    travelType: str | None = None
    budget: BudgetSchema | None = None
    budgetMode: str | None = None
    generatedItinerary: dict | None = None
    travelMeans: dict | None = None
    tripState: dict | None = None
    chatHistory: list | None = None
    conversationId: str | None = None
    isPublic: bool | None = None
    tags: list[str] | None = None

