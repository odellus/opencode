def fibonacci(n: int) -> int:
    """
    Calculate the nth Fibonacci number.
    
    The Fibonacci sequence is a series of numbers where each number is the sum
    of the two preceding ones, usually starting with 0 and 1.
    
    Args:
        n: A non-negative integer representing the position in the Fibonacci sequence.
           Must be >= 0.
    
    Returns:
        The nth Fibonacci number.
        
    Raises:
        ValueError: If n is a negative integer.
        
    Examples:
        >>> fibonacci(0)
        0
        >>> fibonacci(1)
        1
        >>> fibonacci(6)
        8
    """
    if n < 0:
        raise ValueError("n must be a non-negative integer")
    
    if n == 0:
        return 0
    elif n == 1:
        return 1
    
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    
    return b