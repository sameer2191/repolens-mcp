import Foundation

final class CheckoutViewModel {
  private var orderCount: Int = 0

  func submitOrder() {
    orderCount += 1
    refreshTotals()
  }

  private func refreshTotals() {
    _ = orderCount
  }
}
