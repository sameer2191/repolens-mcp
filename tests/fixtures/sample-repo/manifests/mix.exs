defmodule Orders.MixProject do
  use Mix.Project

  def project do
    [
      app: :orders_elixir,
      deps: [
        {:phoenix, "~> 1.7"},
        {:jason, "~> 1.4"}
      ]
    ]
  end
end
